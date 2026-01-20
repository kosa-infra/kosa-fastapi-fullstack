let isCreating = false;
let nodesData = []; // 노드 데이터 캐싱

// 통합 초기화 함수
async function initDashboard() {
  await Promise.all([loadNodes(), loadVms()]);
  setInterval(loadVms, 5000); // VM만 주기적 갱신
}

// 노드 목록 로드 (동적 select 생성)
async function loadNodes() {
  try {
    const res = await fetch("/provision/api/nodes");
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
  } catch (error) {
    console.error("노드 목록 로드 실패:", error);
    document.getElementById("nodeZoneSelect").innerHTML =
      '<option value="">노드 목록 로드 실패</option>';
  }
}

// VM 생성 폼 처리
async function handleVmCreate(e) {
  e.preventDefault();
  if (isCreating) return;

  const form = e.target;
  const submitBtn = document.getElementById("submitBtn");
  const loading = document.getElementById("loading");

  isCreating = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "생성 중...";
  loading.style.display = "block";

  try {
    const formData = Object.fromEntries(new FormData(form));

    // 필수 필드 검증
    if (!formData.node_zone) {
      throw new Error("노드를 선택해주세요.");
    }

    const res = await fetch("/provision/api/vm/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });

    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();

    alert(
      `VM 생성 완료!\nID: ${result.vmid}\n노드: ${result.node}\n이름: ${result.name}`,
    );

    form.reset();
    loadVms(); // 목록 갱신
  } catch (error) {
    alert(`생성 실패: ${error.message}`);
  } finally {
    isCreating = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "VM 생성 시작";
    loading.style.display = "none";
  }
}

// VM 목록 로드
async function loadVms() {
  try {
    const res = await fetch("/provision/api/vms");
    const data = await res.json();
    let vms = data.vms || data;

    const vmList = document.getElementById("vmList");
    vmList.innerHTML = vms.length
      ? vms
          .map(
            (vm) => `
            <div class="vm-item" data-vmid="${vm.vmid}" data-status="${vm.status}">
              <div class="vm-info">
                <div>
                  <strong>${vm.name}</strong>
                  <span class="vm-id">#${vm.vmid}</span>
                  <span class="vm-node">@${vm.node}</span>
                </div>
                <div>
                  <span class="vm-status status-${getStatusClass(vm.status)}"
                    >${vm.status}</span
                  >
                  ${
                    vm.mem
                      ? `<span class="vm-resources"
                    >${Math.round(vm.mem / 1048576)}MB</span
                  >`
                      : ""
                  }
                </div>
              </div>
              <div class="vm-controls">
                <button
                  class="vm-btn start ${vm.status === 'running' ? 'disabled' : ''}"
                  onclick="controlVm('${vm.node}', ${vm.vmid}, 'start')"
                  title="시작"
                >
                  ▶
                </button>
                <button
                  class="vm-btn stop ${vm.status !== 'running' ? 'disabled' : ''}"
                  onclick="controlVm('${vm.node}', ${vm.vmid}, 'shutdown')"
                  title="중지"
                >
                  ⏹
                </button>
                <button
                  class="vm-btn config"
                  onclick="openConfigModal('${vm.node}', ${vm.vmid}, '${vm.name}')"
                  title="설정"
                >
                  ⚙
                </button>
                <button
                  class="vm-btn delete"
                  onclick="confirmDelete('${vm.node}', ${vm.vmid}, '${vm.name}', '${vm.status}')"
                  title="삭제"
                >
                  🗑
                </button>
              </div>
            </div>
            `,
          )
          .join("")
      : '<div style="text-align: center; color: #6b7280; padding: 40px">생성된 VM이 없습니다.</div>';

    updateStats(vms);
  } catch (error) {
    console.error(error);
  }
}

// 4. 통계 업데이트 (재사용)
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

// 5. 상태 클래스 변환
function getStatusClass(status) {
  return status === "running"
    ? "running"
    : status === "stopped"
      ? "stopped"
      : "other";
}

async function controlVm(node, vmid, action) {
  const actions = {
    start: "시작",
    shutdown: "중지",
    config: "설정 변경",
    delete: "삭제",
  };

  if (!confirm(`${vmid} VM을 ${actions[action]}할까요?`)) return;

  try {
    const res = await fetch("/provision/api/vm/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node, vmid }),
    });

    if (!res.ok) {
      const error = await res.text();
      alert(`${actions[action]} 실패: ${error}`);
    } else {
      alert(`${actions[action]} 완료!`);
      loadVms(); // 즉시 갱신
    }
  } catch (error) {
    alert(`${actions[action]} 오류: ${error.message}`);
  }
}

// 상태별 버튼 비활성화 (loadVms 후 호출 가능하도록)
function updateVmButtons() {
  document.querySelectorAll(".vm-btn.start").forEach((btn) => {
    const item = btn.closest(".vm-item");
    const status = item.querySelector(".vm-status").textContent;
    btn.disabled = status === "running";
  });

  document.querySelectorAll(".vm-btn.stop").forEach((btn) => {
    const item = btn.closest(".vm-item");
    const status = item.querySelector(".vm-status").textContent;
    btn.disabled = status !== "running";
  });
}

// 삭제 확인 (상태별 메시지)
async function confirmDelete(node, vmid, name, status) {
  let message = `VM "${name}" (#${vmid})을 삭제하시겠습니까?`;

  if (status === "running") {
    message = `VM "${name}"이 실행중입니다!\n강제 삭제하시겠습니까? (데이터 손실 위험)\n\n${message}`;
  }

  if (!confirm(message)) return;

  await controlVm(node, vmid, "delete");
}

// 설정 모달 열기
function openConfigModal(node, vmid, name) {
  document.getElementById("configModal").classList.add("active");
  document.getElementById("modalTitle").textContent = `${name} 설정`;
  document.getElementById("configNode").value = node;
  document.getElementById("configVmid").value = vmid;

  // 기본값 설정 (API에서 현재 설정 가져오려면 별도 호출 필요)
  document.getElementById("configVcpu").value = 1;
  document.getElementById("configMemory").value = 1024;
  document.getElementById("configResize").value = 20;
}

// 설정 모달 닫기
function closeConfigModal() {
  document.getElementById("configModal").classList.remove("active");
  document.getElementById("configForm").reset();
}

// 설정 적용
document.getElementById("configForm").addEventListener("submit", async (e) => {
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
});

// DOM 이벤트 바인딩 (한 번만)
document.addEventListener("DOMContentLoaded", function () {
  // 초기화
  initDashboard();

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
});
