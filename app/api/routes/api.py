import asyncio
import logging
import uuid
from functools import lru_cache

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import RedirectResponse
from proxmoxer import ProxmoxAPI
from proxmoxer.core import ResourceException
from pydantic import BaseModel, field_validator
from starlette.datastructures import URL

from app.core.config import settings

router = APIRouter(prefix="/api", tags=["api"])
logger = logging.getLogger(__name__)


@lru_cache(maxsize=None)
def get_proxmox(cluster_name: str) -> ProxmoxAPI:
    cluster_conf = settings.PROXMOX_CLUSTERS.get(cluster_name)
    if not cluster_conf:
        raise ValueError(f"Unknown Proxmox cluster: {cluster_name}")

    try:
        return ProxmoxAPI(
            cluster_conf["host"],
            user=cluster_conf["user"],
            token_name=cluster_conf["token_name"],
            token_value=cluster_conf["token_value"],
            verify_ssl=False,
        )
    except Exception as e:
        logger.error("ProxmoxAPI init failed for %s: %s", cluster_name, e)
        raise RuntimeError(
            f"Failed to connect to Proxmox cluster {cluster_name}"
        ) from e


class VMRequest(BaseModel):
    cluster_name: str
    agent: int = settings.VM_TEMPLATE["agent"]
    vcpu: int = settings.VM_TEMPLATE["vcpu"]
    cpu: str = settings.VM_TEMPLATE["cpu"]
    memory: int = settings.VM_TEMPLATE["memory"]
    resize: int = settings.VM_TEMPLATE["resize"]
    cicustom: str | None = settings.VM_TEMPLATE["cicustom"]
    ciuser: str = settings.VM_TEMPLATE["ciuser"]
    cipassword: str = settings.VM_TEMPLATE["cipassword"]
    ipconfig0: str = settings.VM_TEMPLATE["ipconfig0"]
    vm_name: str | None = None
    ssh_public_key: str | None = None

    @field_validator("vcpu")
    @classmethod
    def validate_vcpu(cls, v: int) -> int:
        if v < 1 or v > 16:
            raise ValueError("vCPU: 1-16")
        return v

    @field_validator("memory")
    @classmethod
    def validate_memory(cls, v: int) -> int:
        if v < 1024 or v > 24576:
            raise ValueError("Memory: 1-24GB (1024-24576MB)")
        return v

    @field_validator("resize")
    @classmethod
    def validate_resize(cls, v: int) -> int:
        if v < 10 or v > 200:
            raise ValueError("Disk: 10-200GB")
        return v


class VMControlRequest(BaseModel):
    cluster_name: str
    node: str
    vmid: int


class VMConfigRequest(BaseModel):
    cluster_name: str
    node: str
    vmid: int
    vcpu: int
    memory: int
    resize: int
    ssh_public_key: str | None = None

    @field_validator("vcpu")
    @classmethod
    def validate_vcpu(cls, v: int) -> int:
        if v < 1 or v > 16:
            raise ValueError("vCPU: 1-16")
        return v

    @field_validator("memory")
    @classmethod
    def validate_memory(cls, v: int) -> int:
        if v < 1024 or v > 24576:
            raise ValueError("Memory: 1024-24576MB (1-24GB)")
        return v

    @field_validator("resize")
    @classmethod
    def validate_resize(cls, v: int) -> int:
        if v < 10 or v > 200:
            raise ValueError("Disk resize: 10-200GB")
        return v


def select_least_stressed_node(proxmox: ProxmoxAPI) -> tuple[str, dict]:
    """Select node with lowest stress score (CPU% + Mem% + RunningVMs/10)"""
    nodes = []

    for node_info in proxmox.nodes.get():
        node = node_info["node"]
        try:
            status = proxmox.nodes(node).status.get()
            vms = proxmox.nodes(node).qemu.get()
            running_vms = len([vm for vm in vms if vm.get("status") == "running"])

            cpu_pct = status.get("cpu", 0)
            mem = status.get("memory", {})
            mem_pct = (mem.get("used", 0) / mem.get("total", 1)) * 100

            # 🔥 Stress score: CPU% + Mem% + (VMs/10) - prefer online nodes
            stress_score = cpu_pct + mem_pct + (running_vms / 10)
            online = status.get("cpu", 0) < 100

            nodes.append(
                {
                    "node": node,
                    "stress_score": round(stress_score, 1),
                    "cpu_pct": round(cpu_pct, 1),
                    "mem_pct": round(mem_pct, 1),
                    "running_vms": running_vms,
                    "online": online,
                    "label": f"{node} (CPU:{cpu_pct:.0f}% MEM:{mem_pct:.0f}% VMs:{running_vms})",
                }
            )
        except Exception:
            continue

    if not nodes:
        raise HTTPException(400, "No suitable nodes available")

    # 🔥 Sort by stress score, then prefer online nodes
    nodes.sort(
        key=lambda n: (
            not n["online"],  # Offline nodes last
            n["stress_score"],
        )
    )

    best_node = nodes[0]
    logger.info(
        f"Selected least stressed node: {best_node['node']} (score: {best_node['stress_score']})"
    )
    return best_node["node"], best_node


async def get_vm_ip(proxmox, node, vmid):
    """Async IP fetch with 1s timeout"""
    try:
        async with asyncio.timeout(1.0):  # Python 3.11+
            # Use aiohttp or async proxmox client if available
            # Fallback: run_sync equivalent
            loop = asyncio.get_event_loop()
            interfaces = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: proxmox.nodes(node)
                    .qemu(vmid)
                    .agent("network-get-interfaces")
                    .get()["result"],
                ),
                timeout=1.0,
            )

        for iface in interfaces:
            if iface["name"] == "eth0":
                for addr in iface.get("ip-addresses", []):
                    if addr.get("ip-address-type") == "ipv4":
                        return addr["ip-address"]
    except (asyncio.TimeoutError, Exception):
        pass
    return None


@router.get("/vms")
async def list_vms(cluster_name: str):
    proxmox = get_proxmox(cluster_name)
    vms: list[dict] = []

    # Get all nodes first (1 API call)
    nodes = proxmox.nodes.get()

    # Collect all IP tasks concurrently per node
    all_ip_tasks = []

    for node_info in nodes:
        node = node_info["node"]
        try:
            # Fast node-level VM list
            vms_on_node = proxmox.nodes(node).qemu.get()

            # Only running VMs get IP queries
            running_vms = [vm for vm in vms_on_node if vm["status"] == "running"]

            # Batch IP fetches (max 5 concurrent per node)
            sem = asyncio.Semaphore(5)

            async def safe_ip_fetch(vmid: int) -> str:
                async with sem:
                    return await get_vm_ip(proxmox, node, vmid)

            ip_tasks = [safe_ip_fetch(int(vm["vmid"])) for vm in running_vms]
            all_ip_tasks.extend(ip_tasks)

            # Build basic VM data (no extra API calls)
            for i, vm in enumerate(vms_on_node):
                ip = (
                    await ip_tasks[i]
                    if i < len(ip_tasks) and vm["status"] == "running"
                    else None
                )

                vms.append(
                    {
                        "vmid": int(vm["vmid"]),
                        "name": vm["name"],
                        "status": vm["status"],
                        "node": node,
                        "cpu": round(vm.get("cpu", 0) * 100, 2),
                        "mem_pct": round(
                            vm.get("mem", 0) / vm.get("maxmem", 0) * 100,
                            2,
                        ),
                        "mem_bytes": int(vm.get("mem", 0)),
                        "maxmem_bytes": int(vm.get("maxmem", 0)),
                        "ip": ip,
                        "disk_size": 20,  # From config parsing if needed
                        "uptime": vm.get("uptime", 0),
                    }
                )

        except Exception as e:
            logger.warning("Node %s scan failed: %s", node, e)

    # Wait for ALL IPs concurrently (across ALL nodes!)
    if all_ip_tasks:
        await asyncio.gather(*all_ip_tasks, return_exceptions=True)

    vms.sort(key=lambda x: x["vmid"])
    return {"vms": vms, "total": len(vms)}


@router.post("/vm/create")
async def create_vm(request: VMRequest, background_tasks: BackgroundTasks):
    # create name & validation
    vm_name = request.vm_name or f"vm-{uuid.uuid4().hex[:8]}"

    vmid = None
    try:
        proxmox = get_proxmox(request.cluster_name)
        logger.info("Creating VM %s on auto-selected node", vm_name)

        target_node, node_info = select_least_stressed_node(proxmox)

        logger.info("Creating VM %s on %s", vm_name, target_node)

        # allocate VMID
        vmid = int(proxmox.cluster.nextid.get())
        logger.info("Allocated VMID: %s", vmid)

        # clone the template
        for template_id in range(9000, 9003):
            try:
                proxmox.nodes(target_node).qemu(template_id).clone.post(
                    newid=vmid, name=vm_name
                )
                break
            except ResourceException:
                if template_id == 9002:
                    raise

        # reconfigure the VM
        proxmox.nodes(target_node).qemu(vmid).config.post(
            cores=request.vcpu,
            memory=request.memory,
            cpu=request.cpu,
            agent=request.agent,
            cicustom=request.cicustom,
            ciuser=request.ciuser,
            cipassword=request.cipassword,
            ipconfig0=request.ipconfig0,
            sshkeys=request.ssh_public_key.replace("\\\\n", "") or "",
        )

        # resize the disk
        try:
            proxmox.nodes(target_node).qemu(vmid).resize.put(
                disk="scsi0", size=f"{request.resize}G"
            )
        except Exception:
            pass

        # start the VM
        background_tasks.add_task(
            start_vm_task, request.cluster_name, target_node, vmid
        )

        return {
            "status": "created",
            "vmid": vmid,
            "name": vm_name,
            "node": target_node,
            "cluster": request.cluster_name,
            "node_info": node_info,
        }

    except Exception as e:
        logger.error("VM creation failed (VMID: %s): %s", vmid, e)
        # Rollback
        if vmid and target_node:
            try:
                get_proxmox(request.cluster_name).nodes(target_node).qemu(
                    vmid
                ).status.stop.post()
                get_proxmox(request.cluster_name).nodes(target_node).qemu(
                    vmid
                ).delete.post()
            except Exception:
                pass
        raise HTTPException(500, f"VM creation failed: {str(e)}") from e


async def start_vm_task(cluster_name: str, node: str, vmid: int):
    try:
        await asyncio.sleep(3)
        proxmox = get_proxmox(cluster_name)
        proxmox.nodes(node).qemu(vmid).status.start.post()
        logger.info("VM %s auto-started on %s", vmid, node)
    except Exception as e:
        logger.error("Auto-start VM %s on %s failed: %s", vmid, node, e)


@router.post("/vm/start")
async def start_vm(request: VMControlRequest):
    node = request.node
    vmid = request.vmid
    try:
        proxmox = get_proxmox(request.cluster_name)
        proxmox.nodes(node).qemu(vmid).status.start.post()
        logger.info("VM %s started on %s", vmid, node)
        return {"status": "started", "vmid": vmid}
    except Exception as e:
        raise HTTPException(500, f"VM start failed: {e}")


@router.post("/vm/shutdown")
async def shutdown_vm(request: VMControlRequest):
    node = request.node
    vmid = request.vmid
    try:
        proxmox = get_proxmox(request.cluster_name)
        proxmox.nodes(node).qemu(vmid).status.shutdown.post()
        logger.info("VM %s shutted down on %s", vmid, node)
        return {"status": "shutted down", "vmid": vmid}
    except Exception as e:
        raise HTTPException(500, f"VM shutdown failed: {e}")


@router.get("/nodes/{cluster_name}/{node}/{vmid}")
async def get_vm(cluster_name: str, node: str, vmid: int):
    try:
        proxmox = get_proxmox(cluster_name)
        status = proxmox.nodes(node).qemu(vmid).status.current.get()
        network = proxmox.nodes(node).qemu(vmid).agent.get("network-get-interfaces")
        logger.info()
        return status, network
    except Exception as e:
        raise HTTPException(500, f"VM get failed: {e}") from e


@router.get("/vm/{cluster_name}/{node}/{vmid}/config")
async def get_vm_config(cluster_name: str, node: str, vmid: int):
    """🔥 Get current VM configuration for reconfigure modal"""
    try:
        proxmox = get_proxmox(cluster_name)

        # Get full config
        config = proxmox.nodes(node).qemu(vmid).config.get()

        # Extract key values with defaults
        current_config = {
            "vcpu": int(config.get("cores", 1)),
            "memory": int(config.get("memory", 1024)),
            "disk_size": "20",  # Will get from resize endpoint or default
            "sshkeys": config.get("sshkeys", "").replace("\\\\n", ""),
        }

        # Get current disk size (scsi0)
        try:
            disk_info = proxmox.nodes(node).qemu(vmid).disks.get()
            for disk in disk_info:
                if disk.get("disk") == "scsi0":
                    size_str = disk.get("size", "20G")
                    # Extract number from "20G" → 20
                    current_config["disk_size"] = int(
                        "".join(filter(str.isdigit, size_str))
                    )
                    current_config["disk_size_raw"] = size_str  # For display
                    break
        except Exception as disk_error:
            logger.warning("Disk size fetch failed: %s", disk_error)
            current_config["disk_size"] = 20
            current_config["disk_size_raw"] = "20G"

        logger.info("VM %s current config: %s", vmid, current_config)
        return current_config

    except Exception as e:
        raise HTTPException(500, f"VM config fetch failed: {e}")


@router.post("/vm/config")
async def config_vm(request: VMConfigRequest):
    try:
        proxmox = get_proxmox(request.cluster_name)

        node = request.node
        vmid = request.vmid

        proxmox.nodes(node).qemu(vmid).config.post(
            cores=request.vcpu,
            memory=request.memory,
            sshkeys=request.ssh_public_key or "",
        )
        proxmox.nodes(node).qemu(vmid).resize.put(
            disk="scsi0", size=f"{request.resize}G"
        )
        logger.info("VM %s reconfigured from %s", vmid, node)
        return {"status": "reconfigured", "vmid": vmid}
    except Exception as e:
        raise HTTPException(500, f"VM config failed: {e}") from e


@router.post("/vm/delete")
async def delete_vm(request: VMControlRequest):
    node = request.node
    vmid = request.vmid

    try:
        proxmox = get_proxmox(request.cluster_name)

        try:
            status = proxmox.nodes(node).qemu(vmid).status.current.get()
            vm_status = status.get("status", "unknown")
        except Exception:
            vm_status = "unknown"

        if vm_status == "running":
            logger.info("VM %s is running, stopping...", vmid)
            proxmox.nodes(node).qemu(vmid).status.stop.post()
            await asyncio.sleep(3)

        proxmox.nodes(node).qemu(vmid).delete()
        logger.info("VM %s deleted from %s", vmid, node)
        return {"status": "deleted", "vmid": vmid}
    except Exception as e:
        raise HTTPException(500, f"VM delete failed: {e}")


@router.get("/nodes/{cluster_name}")
async def get_nodes(cluster_name: str):
    try:
        proxmox = get_proxmox(cluster_name)
        nodes = []

        # scan all nodes
        node_list = proxmox.nodes.get()

        for node_info in node_list:
            node = node_info["node"]
            try:
                # check the nodes status
                status = proxmox.nodes(node).status.get()
                vms = proxmox.nodes(node).qemu.get()
                running_vms = len([vm for vm in vms if vm.get("status") == "running"])

                # VM count
                vms = proxmox.nodes(node).qemu.get()
                vm_count = len([vm for vm in vms if vm.get("status") == "running"])

                # memory usage
                memory = status.get("memory", {})
                mem_used_gb = round(memory.get("used", 0) / (1024**3), 1)
                mem_total_gb = round(memory.get("total", 0) / (1024**3), 1)
                mem_usage = round(
                    (memory.get("used", 0) / memory.get("total", 0)) * 100, 1
                )
                mem_pct = round(
                    (memory.get("used", 0) / memory.get("total", 0)) * 100, 1
                )
                cpu_pct = round(status.get("cpu", 0), 1)

                # Calculate stress score for display
                stress_score = cpu_pct + mem_pct + (running_vms / 10)

                node_status = "online" if status.get("cpu", 0) < 100 else "high-load"

                nodes.append(
                    {
                        "value": node,
                        "label": f"{node} (S:{stress_score:.0f} CPU:{cpu_pct:.0f}% MEM:{mem_pct:.0f}% VMs:{running_vms})",
                        "status": node_status,
                        "cpu": cpu_pct,
                        "mem_usage": mem_pct,
                        "mem_used_gb": mem_used_gb,
                        "mem_total_gb": mem_total_gb,
                        "vm_count": running_vms,
                        "stress_score": round(stress_score, 1),
                        "zone": "public" if "public" in node.lower() else "private",
                    }
                )

            except Exception as e:
                logger.warning("Node {node} scan failed: %s", e)
                nodes.append(
                    {
                        "value": node,
                        "label": f"{node} (offline)",
                        "status": "offline",
                        "cpu": 0,
                        "mem_usage": 0,
                        "vm_count": 0,
                        "stress_score": 999,
                    }
                )

        # order by CPU usage
        nodes.sort(key=lambda x: x["value"])

        return {"nodes": nodes, "algorithm": "CPU% + MEM% + (VMs/10)"}

    except Exception as e:
        logger.error("Failed to fetch nodes: %s", e)
        raise HTTPException(500) from e


class UserData(BaseModel):
    username: str


@router.post("/get-redirect")
async def handle_post(data: UserData, request: Request):
    redirect_url = request.url_for("dashboard").include_query_params(user=data.username)
    return RedirectResponse(redirect_url, status_code=303)
