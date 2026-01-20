import asyncio
import logging
import uuid
from functools import lru_cache

from fastapi import APIRouter, BackgroundTasks, HTTPException
from proxmoxer import ProxmoxAPI
from pydantic import BaseModel, field_validator

from app.core.config import settings

router = APIRouter(prefix="/api", tags=["api"])
logger = logging.getLogger(__name__)


@lru_cache(1)
def get_proxmox() -> ProxmoxAPI:
    try:
        return ProxmoxAPI(
            settings.PROXMOX_HOST,
            user=settings.PROXMOX_USER,
            token_name=settings.PROXMOX_TOKEN_NAME,
            token_value=settings.PROXMOX_TOKEN_VALUE,
            verify_ssl=False,
        )
    except Exception as e:
        logger.error("ProxmoxAPI initialization failed: %s", e)
        raise RuntimeError(f"Failed to connect to Proxmox: {e}") from e


class VMRequest(BaseModel):
    node_zone: str
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
    node: str
    vmid: int


class VMConfigRequest(BaseModel):
    node: str
    vmid: int
    vcpu: int
    memory: int
    resize: int

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


@router.get("/vms")
async def list_vms():
    try:
        proxmox = get_proxmox()
        vms = []
        nodes = proxmox.nodes.get()

        for node_info in nodes:
            node = node_info["node"]
            try:
                for vm in proxmox.nodes(node).qemu.get():
                    vms.append(
                        {
                            "vmid": int(vm["vmid"]),
                            "name": vm["name"],
                            "status": vm["status"],
                            "node": node,
                            "mem": vm.get("mem", 0),
                            "uptime": vm.get("uptime", 0),
                        }
                    )
            except Exception as e:
                logger.warning("Node %s scan failed: %s", node, e)
        vms.sort(key=lambda x: x["vmid"])
        return {"vms": vms, "total": len(vms)}
    except Exception as e:
        logger.error("List VMs failed: %s", e)
        raise HTTPException(500, "Failed to list VMs") from e


@router.post("/vm/create")
async def create_vm(request: VMRequest, background_tasks: BackgroundTasks):
    # create name & validation
    vm_name = request.vm_name or f"vm-{uuid.uuid4().hex[:8]}"

    # node selection
    target_node = request.node_zone
    if not target_node:
        raise HTTPException(400, f"Invalid node_zone: {request.node_zone}")

    vmid = None
    try:
        proxmox = get_proxmox()
        logger.info("Creating VM %s on %s", vm_name, target_node)

        # allocate VMID
        vmid = int(proxmox.cluster.nextid.get())
        logger.info("Allocated VMID: %s", vmid)

        # clone the template
        proxmox.nodes(target_node).qemu(9000).clone.post(newid=vmid, name=vm_name)

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
        )

        # resize the disk
        try:
            proxmox.nodes(target_node).qemu(vmid).resize.put(
                disk="scsi0", size=f"{request.resize}G"
            )
        except Exception:
            pass

        # start the VM
        background_tasks.add_task(start_vm_task, target_node, vmid)

        return {
            "status": "created",
            "vmid": vmid,
            "name": vm_name,
            "node": target_node,
            "region": request.node_zone,
        }

    except Exception as e:
        logger.error("VM creation failed (VMID: %s): %s", vmid, e)
        # Rollback
        if vmid and target_node:
            try:
                get_proxmox().nodes(target_node).qemu(vmid).status.stop.post()
                get_proxmox().nodes(target_node).qemu(vmid).delete.post()
            except Exception:
                pass
        raise HTTPException(500, f"VM creation failed: {str(e)}") from e


async def start_vm_task(node: str, vmid: int):
    try:
        await asyncio.sleep(3)
        proxmox = get_proxmox()
        proxmox.nodes(node).qemu(vmid).status.start.post()
        logger.info("VM %s auto-started on %s", vmid, node)
    except Exception as e:
        logger.error("Auto-start VM %s on %s failed: %s", vmid, node, e)


@router.post("/vm/start")
async def start_vm(request: VMControlRequest):
    node = request.node
    vmid = request.vmid
    try:
        proxmox = get_proxmox()
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
        proxmox = get_proxmox()
        proxmox.nodes(node).qemu(vmid).status.shutdown.post()
        logger.info("VM %s shutted down on %s", vmid, node)
        return {"status": "shutted down", "vmid": vmid}
    except Exception as e:
        raise HTTPException(500, f"VM shutdown failed: {e}")


@router.get("/nodes/{node}/{vmid}")
async def get_vm(node: str, vmid: int):
    try:
        proxmox = get_proxmox()
        status = proxmox.nodes(node).qemu(vmid).status.current.get()
        network = proxmox.nodes(node).qemu(vmid).agent.get("network-get-interfaces")
        logger.info()
        return status, network
    except Exception as e:
        raise HTTPException(500, f"VM get failed: {e}") from e


@router.post("/vm/config")
async def config_vm(request: VMConfigRequest):
    try:
        proxmox = get_proxmox()

        node = request.node
        vmid = request.vmid

        proxmox.nodes(node).qemu(vmid).config.post(
            cores=request.vcpu,
            memory=request.memory,
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
        proxmox = get_proxmox()

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


@router.get("/nodes")
async def get_nodes():
    try:
        proxmox = get_proxmox()
        nodes = []

        # scan all nodes
        node_list = proxmox.nodes.get()

        for node_info in node_list:
            node = node_info["node"]
            try:
                # check the nodes status
                status = proxmox.nodes(node).status.get()
                node_status = "online" if status.get("cpu", 0) < 100 else "high-load"

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

                nodes.append(
                    {
                        "value": node,
                        "label": f"{node} ({mem_used_gb}/{mem_total_gb}GB, CPU:{status.get('cpu', 0):.1f}%, VM:{vm_count})",
                        "status": node_status,
                        "cpu": round(status.get("cpu", 0), 1),
                        "mem_usage": mem_usage,
                        "mem_used_gb": mem_used_gb,
                        "mem_total_gb": mem_total_gb,
                        "vm_count": vm_count,
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
                    }
                )

        # order by CPU usage
        nodes.sort(key=lambda x: x["value"])

        return {"nodes": nodes}

    except Exception as e:
        logger.error("Failed to fetch nodes: %s", e)
        raise HTTPException(500) from e
