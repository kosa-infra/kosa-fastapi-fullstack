// 🔥 🔥 🔥 전역 함수들 (HTML onclick에서 호출되므로 function 선언) 🔥 🔥 🔥
function getStatusClass(status) {
  return status === "running"
    ? "running"
    : status === "stopped"
      ? "stopped"
      : "other";
}

function updateStats(vms) {
  const vmsArray = Array.isArray(vms) ? vms : [];
  document.getElementById("vm-count").textContent = vmsArray.length;
  document.getElementById("total-vms").textContent = vmsArray.length;
  document.getElementById("running-vms").textContent = vmsArray.filter(
    (v) => v.status === "running",
  ).length;
  document.getElementById("stopped-vms").textContent = vmsArray.filter(
    (v) => v.status === "stopped",
  ).length;
}

function controlVm(clusterName, node, vmid, action) {
  const actions = {
    start: "시작",
    shutdown: "중지",
    delete: "삭제",
  };

  // 🔥 delete는 confirmDelete에서 이미 확인했으므로 skip
  const needsConfirm = action !== "delete";
  if (needsConfirm && !confirm(`${vmid} VM을 ${actions[action]}할까요?`)) {
    return;
  }

  fetch(`/provision/api/vm/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cluster_name: clusterName, node, vmid }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const error = await res.text();
        throw new Error(error);
      }
      alert(`${actions[action]} 완료!`);
      loadVms();
    })
    .catch((error) => alert(`${actions[action]} 오류: ${error.message}`));
}

function confirmDelete(clusterName, node, vmid, name, status) {
  let message = `VM "${name}" (#${vmid})을 삭제하시겠습니까?`;

  // 실행중이면 추가 경고 (한 번만!)
  if (status === "running") {
    message = `⚠️ VM "${name}"이 실행중입니다!\n강제 삭제시 데이터 손실 위험이 있습니다.\n\n그래도 삭제하시겠습니까?`;
  }

  // 🔥 한 번만 confirm
  if (confirm(message)) {
    controlVm(clusterName, node, vmid, "delete");
  }
}

function openConfigModal(clusterName, node, vmid, name) {
  document.getElementById("configModal").classList.add("active");
  document.getElementById("modalTitle").textContent = `${name} 설정`;
  document.getElementById("configCluster").value = clusterName;
  document.getElementById("configNode").value = node;
  document.getElementById("configVmid").value = vmid;
  document.getElementById("configVcpu").value = 1;
  document.getElementById("configMemory").value = 1024;
  document.getElementById("configResize").value = 20;
}

function closeConfigModal() {
  document.getElementById("configModal").classList.remove("active");
}

// 🔥 내부 전용 변수 및 함수들
let isCreating = false;
let nodesData = [];
let currentCluster = null;

// 🔄 통합 초기화
async function initDashboard() {
  setupEventListeners();
}

// 🆕 클러스터별 노드 로드
async function loadNodes(clusterName) {
  if (!clusterName) return;

  try {
    const res = await fetch(`/provision/api/nodes/${clusterName}`);
    const data = await res.json();
    nodesData = data.nodes || [];

    const select = document.getElementById("nodeZoneSelect");
    select.innerHTML = '<option value="">노드를 선택하세요</option>';

    nodesData.forEach((node) => {
      const option = document.createElement("option");
      option.value = node.value;
      option.textContent = node.label;
      option.dataset.status = node.status;
      select.appendChild(option);
    });

    select.disabled = false;
  } catch (error) {
    console.error("노드 목록 로드 실패:", error);
    document.getElementById("nodeZoneSelect").innerHTML =
      '<option value="">노드 목록 로드 실패</option>';
  }
}

// 🆕 클러스터 변경 핸들러
async function onClusterChange(clusterName) {
  currentCluster = clusterName;
  const clusterDisplay = document.getElementById("current-cluster");
  if (clusterName === "cluster_a") {
    clusterDisplay.textContent = "Region A";
  } else if (clusterName === "cluster_b") {
    clusterDisplay.textContent = "Region B";
  } else {
    clusterDisplay.textContent = "";
  }

  const nodeSelect = document.getElementById("nodeZoneSelect");
  nodeSelect.innerHTML = '<option value="">노드를 선택하세요</option>';
  nodeSelect.disabled = !clusterName;
  document.getElementById("nodeStatus").textContent = "";

  if (clusterName) {
    await loadNodes(clusterName);
    await loadVms();
  } else {
    document.getElementById("vmList").innerHTML =
      "클러스터를 선택한 후 새로고침하세요";
    updateStats([]);
  }
}

// VM 생성 폼 처리
async function handleVmCreate(e) {
  e.preventDefault();
  if (isCreating) return;

  const form = e.target;
  const submitBtn = document.getElementById("submitBtn");
  const loading = document.getElementById("loading");

  // 생성 전 선택값 저장
  const clusterName = document.getElementById("clusterSelect").value;
  const nodeZone = document.getElementById("nodeZoneSelect").value;

  isCreating = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "생성 중...";
  loading.style.display = "block";

  try {
    const formData = Object.fromEntries(new FormData(form));
    if (!formData.cluster_name) throw new Error("클러스터를 선택해주세요.");
    if (!formData.node_zone) throw new Error("노드를 선택해주세요.");

    const res = await fetch("/provision/api/vm/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });

    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();

    alert(
      `VM 생성 완료!\n클러스터: ${result.region || clusterName}\nID: ${result.vmid}\n노드: ${result.node}\n이름: ${result.name}`,
    );

    // 선택값 복원
    document.getElementById("clusterSelect").value = clusterName;
    document.getElementById("nodeZoneSelect").value = nodeZone;

    loadVms();
  } catch (error) {
    alert(`생성 실패: ${error.message}`);
  } finally {
    isCreating = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "VM 생성 시작";
    loading.style.display = "none";
  }
}

// 🆕 클러스터별 VM 목록 로드 (항상 DOM에서 clusterName 확인)
async function loadVms() {
  const clusterName = document.getElementById("clusterSelect").value;
  if (!clusterName) {
    console.log("클러스터 미선택, VM 로드 스킵");
    return;
  }

  currentCluster = clusterName;

  try {
    const res = await fetch(`/provision/api/vms?cluster_name=${clusterName}`);
    const data = await res.json();
    let vms = data.vms || data;

    const vmList = document.getElementById("vmList");
    vmList.innerHTML = vms.length
      ? vms
          .map((vm) => {
            const statusClass = getStatusClass(vm.status);
            return `
            <div class="vm-item" data-vmid="${vm.vmid}" data-status="${vm.status}">
              <div class="vm-info">
                <div>
                  <strong>${vm.name}</strong>
                  <span class="vm-id">#${vm.vmid}</span>
                  <span class="vm-node">@${vm.node}</span>
                </div>
                <div>
                  <span class="vm-status status-${statusClass}">${vm.status}</span>
                  ${vm.mem ? `<span class="vm-resources">${Math.round(vm.mem / 1048576)}MB</span>` : ""}
                </div>
              </div>
              <div class="vm-controls">
                <button class="vm-btn start ${vm.status === "running" ? "disabled" : ""}"
                  onclick="controlVm('${clusterName}', '${vm.node}', ${vm.vmid}, 'start')"
                  title="시작">▶</button>
                <button class="vm-btn stop ${vm.status !== "running" ? "disabled" : ""}"
                  onclick="controlVm('${clusterName}', '${vm.node}', ${vm.vmid}, 'shutdown')"
                  title="중지">⏹</button>
                <button class="vm-btn config" 
                  onclick="openConfigModal('${clusterName}', '${vm.node}', ${vm.vmid}, '${vm.name}')"
                  title="설정">⚙</button>
                <button class="vm-btn delete"
                  onclick="confirmDelete('${clusterName}', '${vm.node}', ${vm.vmid}, '${vm.name}', '${vm.status}')"
                  title="삭제">🗑</button>
              </div>
            </div>
          `;
          })
          .join("")
      : '<div style="text-align: center; color: #6b7280; padding: 40px">생성된 VM이 없습니다.</div>';

    updateStats(vms);
  } catch (error) {
    console.error("VM 목록 로드 실패:", error);
    document.getElementById("vmList").innerHTML =
      '<div style="color: #ef4444">VM 목록 로드 실패</div>';
  }
}

// 설정 적용
document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("configForm").onsubmit = async function (e) {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(e.target));

    try {
      const res = await fetch("/provision/api/vm/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error(await res.text());

      alert("설정 변경 완료! VM이 켜져 있다면 껐다가 켜야 합니다.");
      closeConfigModal();
      loadVms();
    } catch (error) {
      alert(`설정 변경 실패: ${error.message}`);
    }
  };
});

// 이벤트 리스너 설정
function setupEventListeners() {
  // 클러스터 변경 감지
  document.getElementById("clusterSelect").addEventListener("change", (e) => {
    onClusterChange(e.target.value);
  });

  // VM 생성 폼
  document.getElementById("vmForm").onsubmit = handleVmCreate;

  // 노드 선택 상태 표시
  document
    .getElementById("nodeZoneSelect")
    .addEventListener("change", function () {
      const statusEl = document.getElementById("nodeStatus");
      if (this.value) {
        const node = nodesData.find((n) => n.value === this.value);
        if (node) {
          statusEl.innerHTML = `
          CPU: ${node.cpu}%, RAM: ${node.mem_usage}%
          (${node.mem_used_gb}/${node.mem_total_gb}GB), VM: ${node.vm_count}
        `;
          statusEl.style.color =
            node.cpu > 80 ? "#ef4444" : node.cpu > 50 ? "#f59e0b" : "#10b981";
        }
      } else {
        statusEl.textContent = "";
      }
    });
}

// DOM 로드 후 초기화
document.addEventListener("DOMContentLoaded", initDashboard);

// 5초마다 현재 클러스터 VM 갱신
setInterval(() => {
  const clusterSelectValue = document.getElementById("clusterSelect").value;
  if (clusterSelectValue) {
    loadVms();
  }
}, 5000);
