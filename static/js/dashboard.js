// 전역 상태 변수들
let isCreating = false;
let currentCluster = null;

// 🔥 상태 클래스 헬퍼
function getStatusClass(status) {
  return status === "running"
    ? "running"
    : status === "stopped"
      ? "stopped"
      : "other";
}

// 🔥 통계 업데이트
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

// 🔥 VM 제어 (start, shutdown, delete)
function controlVm(clusterName, node, vmid, action) {
  const actions = {
    start: "시작",
    shutdown: "중지",
    delete: "삭제",
  };

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

// 🔥 VM 삭제 확인 (실행중일 때 추가 경고)
function confirmDelete(clusterName, node, vmid, name, status) {
  let message = `VM "${name}" (#${vmid})을 삭제하시겠습니까?`;

  if (status === "running") {
    message = `⚠️ VM "${name}"이 실행중입니다!\n강제 삭제시 데이터 손실 위험이 있습니다.\n\n그래도 삭제하시겠습니까?`;
  }

  if (confirm(message)) {
    controlVm(clusterName, node, vmid, "delete");
  }
}

// 🔥 설정 모달 열기 - 현재 설정 + 디스크 검증 데이터
async function openConfigModal(clusterName, node, vmid, name) {
  document.getElementById("configModal").classList.add("active");
  document.getElementById("modalTitle").textContent = `${name} 설정 변경`;

  document.getElementById("configCluster").value = clusterName;
  document.getElementById("configNode").value = node;
  document.getElementById("configVmid").value = vmid;

  const currentConfigEl = document.getElementById("currentConfig");
  const configLoading = document.getElementById("configLoading");
  currentConfigEl.textContent = "현재 설정 로드 중...";
  configLoading.style.display = "block";

  try {
    const res = await fetch(
      `/provision/api/vm/${clusterName}/${node}/${vmid}/config`,
    );
    if (!res.ok) throw new Error(await res.text());

    const config = await res.json();

    // 🔥 폼에 현재 값 + 검증 데이터 설정
    document.getElementById("configVcpu").value = config.vcpu || 1;
    document.getElementById("configMemory").value = config.memory || 1024;
    const diskInput = document.getElementById("configResize");
    diskInput.value = config.disk_size || 20;
    diskInput.dataset.currentSize = config.disk_size || 20; // 🔥 디스크 축소 방지 검증용

    // 현재 설정 표시 (RAM MB 단위)
    const memMB = config.memory || 1024;
    const memGB = Math.round(memMB / 1024);
    currentConfigEl.innerHTML = `
      <strong>현재 설정:</strong> 
      vCPU <strong>${config.vcpu || 1}</strong>코어 | 
      RAM <strong>${memMB}MB</strong> (${memGB}GB) | 
      디스크 <strong>${config.disk_size_raw || "20G"}</strong>
    `;
  } catch (error) {
    console.error("설정 로드 실패:", error);
    currentConfigEl.innerHTML =
      '<span style="color: #ef4444;">⚠️ 설정 로드 실패 - 기본값 사용</span>';
  } finally {
    configLoading.style.display = "none";
  }
}

// 🔥 설정 모달 닫기
function closeConfigModal() {
  document.getElementById("configModal").classList.remove("active");
}

// 🔥 클러스터 변경 핸들러 (노드 자동선택)
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

  const autoNodeStatus = document.getElementById("autoNodeStatus");
  if (clusterName) {
    autoNodeStatus.innerHTML =
      "🤖 <strong>최저 부하 노드 자동 선택</strong><br>" +
      "<small>알고리즘: CPU% + RAM% + (실행중 VM/10)</small>";
    autoNodeStatus.style.color = "#10b981";
  } else {
    autoNodeStatus.innerHTML =
      "클러스터를 선택하면 <strong>최저 부하 노드가 자동으로 선택</strong>됩니다<br>" +
      "<small>알고리즘: CPU% + RAM% + (실행중 VM/10)</small>";
    autoNodeStatus.style.color = "#6b7280";
  }

  if (clusterName) {
    await loadVms();
  } else {
    document.getElementById("vmList").innerHTML =
      '<div style="text-align: center; color: #6b7280; padding: 40px;">클러스터를 선택한 후 새로고침하세요</div>';
    updateStats([]);
  }
}

// 🔥 VM 생성 폼 처리 (노드 자동선택)
async function handleVmCreate(e) {
  e.preventDefault();
  if (isCreating) return;

  const form = e.target;
  const submitBtn = document.getElementById("submitBtn");
  const loading = document.getElementById("loading");
  const clusterName = document.getElementById("clusterSelect").value;

  isCreating = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "최적 노드 분석 중...";
  loading.style.display = "block";
  loading.textContent = "1️⃣ 최저 부하 노드 분석 → 2️⃣ VM 생성 중...";

  try {
    const formData = Object.fromEntries(new FormData(form));
    formData.ssh_public_key = encodeURIComponent(formData.ssh_public_key);
    if (!formData.cluster_name) throw new Error("클러스터를 선택해주세요.");

    const res = await fetch("/provision/api/vm/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });

    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();

    const stressScore = result.node_info?.stress_score || "N/A";
    const nodeInfo = result.node_info
      ? `CPU:${result.node_info.cpu_pct}% MEM:${result.node_info.mem_pct}% VMs:${result.node_info.running_vms}`
      : "";

    alert(
      `✅ VM 생성 완료!\n\n` +
        `📍 클러스터: ${result.cluster || clusterName}\n` +
        `🖥️  노드: ${result.node}\n` +
        `🆔 ID: ${result.vmid}\n` +
        `📛 이름: ${result.name}\n` +
        `⚖️  부하점수: ${stressScore}\n` +
        `${nodeInfo ? `ℹ️  ${nodeInfo}` : ""}`,
    );

    form.reset();
    document.getElementById("clusterSelect").value = clusterName;
    loadVms();
  } catch (error) {
    console.error("VM 생성 실패:", error);
    alert(`❌ VM 생성 실패: ${error.message}`);
  } finally {
    isCreating = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "🚀 VM 생성 (최저 부하 노드 자동 선택)";
    loading.style.display = "none";
  }
}

function getMetricColor(value) {
  if (value < 50) return "low";
  if (value < 80) return "moderate";
  return "high";
}

function getGaugeWidth(value) {
  // 0% = 5%, 100% = 100% (선형 스케일링)
  return Math.max(5, (value / 100) * 95 + 5);
}

// 🔥 FIXED RAM 계산 헬퍼 함수
function calculateRamDisplay(memBytes, maxmemBytes) {
  const memMb = Math.round(memBytes / 1024 / 1024);
  const maxmemMb = Math.round(maxmemBytes / 1024 / 1024);
  const pct = maxmemBytes > 0 ? Math.round((memBytes / maxmemBytes) * 100) : 0;
  return { memMb, maxmemMb, pct };
}

// 🔥 클러스터별 VM 목록 로드 (RAM ✅ FIXED)
async function loadVms() {
  const clusterName = document.getElementById("clusterSelect").value;
  if (!clusterName) {
    console.log("클러스터 미선택, VM 로드 스킵");
    return;
  }

  currentCluster = clusterName;

  try {
    const res = await fetch(`/provision/api/vms?cluster_name=${clusterName}`);
    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();
    let vms = data.vms || data;

    const vmList = document.getElementById("vmList");

    if (vms.length) {
      vmList.innerHTML = vms
        .map((vm) => {
          const statusClass = getStatusClass(vm.status);

          // 🔥 CPU gauge (0-100%)
          const cpuClass = getMetricColor(vm.cpu);
          const cpuWidth = getGaugeWidth(vm.cpu);

          // 🔥 FIXED RAM gauge - bytes → MB conversion
          const ramData = calculateRamDisplay(
            vm.mem_bytes || 0,
            vm.maxmem_bytes || 1073741824,
          );
          const ramClass = getMetricColor(ramData.pct);
          const ramWidth = getGaugeWidth(ramData.pct);

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
      ${vm.ip ? `<span class="vm-ip">🌐 ${vm.ip}</span>` : ""}
    </div>
    
    <!-- 🔥 CPU & RAM Gauges (FIXED RAM) -->
    <div class="vm-metrics">
      <div class="metric">
        <span class="metric-label">🧠 CPU</span>
        <div class="metric-bar-container">
          <div class="metric-bar cpu ${cpuClass}" style="width: ${cpuWidth}%">
            ${vm.cpu}%
          </div>
        </div>
        <span class="metric-value">${vm.cpu.toFixed(0)}%</span>
      </div>
      
      <div class="metric">
        <span class="metric-label">💾 RAM</span>
        <div class="metric-bar-container">
          <div class="metric-bar ram ${ramClass}" style="width: ${ramWidth}%">
            ${ramData.memMb}/${ramData.maxmemMb}MB
          </div>
        </div>
        <span class="metric-value">${ramData.pct}%</span>
      </div>
    </div>
  </div>

  <div class="vm-controls">
    <button class="vm-btn start ${vm.status === "running" ? "disabled" : ""}"
      onclick="controlVm('${clusterName}', '${vm.node}', ${vm.vmid}, 'start')"
      title="시작" ${vm.status === "running" ? "disabled" : ""}>▶</button>
    <button class="vm-btn stop ${vm.status !== "running" ? "disabled" : ""}"
      onclick="controlVm('${clusterName}', '${vm.node}', ${vm.vmid}, 'shutdown')"
      title="중지" ${vm.status !== "running" ? "disabled" : ""}>⏹</button>
    <button class="vm-btn config" 
      onclick="openConfigModal('${clusterName}', '${vm.node}', ${vm.vmid}, '${vm.name}')"
      title="설정 변경">⚙</button>
    <button class="vm-btn delete"
      onclick="confirmDelete('${clusterName}', '${vm.node}', ${vm.vmid}, '${vm.name}', '${vm.status}')"
      title="삭제">🗑</button>
  </div>
</div>
          `;
        })
        .join("");
    } else {
      vmList.innerHTML =
        '<div style="text-align: center; color: #6b7280; padding: 40px;">' +
        "🎉 생성된 VM이 없습니다.<br><strong>새 VM을 생성해보세요!</strong></div>";
    }

    updateStats(vms);
  } catch (error) {
    console.error("VM 목록 로드 실패:", error);
    document.getElementById("vmList").innerHTML =
      '<div style="text-align: center; color: #ef4444; padding: 40px;">' +
      "❌ VM 목록 로드 실패<br>클러스터를 다시 선택해주세요</div>";
  }
}

// 🔥 수동 새로고침 함수
function refreshVms() {
  loadVms();
}

// 🔥 이벤트 리스너 설정
function setupEventListeners() {
  document.getElementById("clusterSelect").addEventListener("change", (e) => {
    onClusterChange(e.target.value);
  });

  document.getElementById("vmForm").addEventListener("submit", handleVmCreate);

  // 🔥 설정 모달 폼 제출 - 디스크 축소 방지
  document
    .getElementById("configForm")
    .addEventListener("submit", async function (e) {
      e.preventDefault();

      const formData = Object.fromEntries(new FormData(e.target));
      formData.ssh_public_key = encodeURIComponent(formData.ssh_public_key);
      const submitBtn = e.target.querySelector('button[type="submit"]');
      const originalText = submitBtn.textContent;

      // 🔥 디스크 크기 축소 방지 검증
      const currentDiskSize =
        parseInt(document.getElementById("configResize").dataset.currentSize) ||
        20;
      const newDiskSize = parseInt(formData.resize);

      if (newDiskSize < currentDiskSize) {
        alert(
          `❌ 디스크 축소 불가능!\n\n` +
            `현재: ${currentDiskSize}GB → 신규: ${newDiskSize}GB\n` +
            `⚠️  Proxmox는 디스크 크기 축소를 지원하지 않습니다.\n` +
            `(확장만 가능)`,
        );
        return;
      }

      // 디스크 크기가 같으면 확인
      if (newDiskSize === currentDiskSize) {
        if (
          !confirm(
            `디스크 크기 변경 없음 (${currentDiskSize}GB)\n\n` +
              `vCPU/Memory만 변경하시겠습니까?\n` +
              `(디스크는 그대로 유지됩니다)`,
          )
        ) {
          return;
        }
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "설정 적용 중...";

      try {
        const res = await fetch("/provision/api/vm/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });

        if (!res.ok) throw new Error(await res.text());

        alert(
          `✅ 설정 변경 완료!\n\n` +
            `vCPU: ${formData.vcpu}코어\n` +
            `RAM: ${(formData.memory / 1024).toFixed(1)}GB (${formData.memory}MB)\n` +
            `디스크: ${formData.resize}GB\n\n` +
            `⚠️ VM 실행중이라면 재시작 필요`,
        );
        closeConfigModal();
        loadVms();
      } catch (error) {
        console.error("설정 변경 실패:", error);
        alert(`❌ 설정 변경 실패: ${error.message}`);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });

  // ESC 키로 모달 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeConfigModal();
    }
  });

  // 모달 외부 클릭으로 닫기
  document.getElementById("configModal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("configModal")) {
      closeConfigModal();
    }
  });
}

// 🔥 통합 초기화
async function initDashboard() {
  console.log("🚀 VM Provisioning Dashboard 초기화 완료!");
  setupEventListeners();

  document.getElementById("autoNodeStatus").innerHTML =
    "클러스터를 선택하면 <strong>최저 부하 노드가 자동으로 선택</strong>됩니다<br>" +
    "<small>알고리즘: CPU% + RAM% + (실행중 VM/10)</small>";
}

// 🔥 10초마다 VM 자동 갱신
setInterval(() => {
  const clusterSelectValue = document.getElementById("clusterSelect").value;
  if (clusterSelectValue) {
    loadVms();
  }
}, 10000);

// 🔥 DOM 로드 완료 후 초기화
document.addEventListener("DOMContentLoaded", initDashboard);
