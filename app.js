
const DBKEY = "myFinancePwaDataV1";
const CLOUDKEY = "myFinanceCloudConfigV1";

const $ = id => document.getElementById(id);

const money = n =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(n) || 0);

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const parseMoney = s => {
  if (typeof s === "number") return s;
  let v = String(s || "").trim().replace(/\s/g, "");
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  return Number(v) || 0;
};

const uid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(16).slice(2);

let state = load();
let filter = "all";
let editingId = null;
let supabaseClient = null;
let cloudUser = null;
let syncing = false;
let syncTimer = null;

function blank() {
  return {
    openingBalance: 0,
    transactions: [],
    debts: [],
    cloud: { url: "", key: "" }
  };
}

function load() {
  try {
    return {
      ...blank(),
      ...JSON.parse(localStorage.getItem(DBKEY) || "{}")
    };
  } catch {
    return blank();
  }
}

function saveLocal() {
  localStorage.setItem(DBKEY, JSON.stringify(state));
  render();
  scheduleCloudSync();
}

function fmtDate(s) {
  if (!s) return "Sem data";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function signed(t) {
  return t.type === "income" ? 1 : -1;
}

function completed(t) {
  return t.status === "paid";
}

function currentTotals() {
  const ts = state.transactions.filter(completed);
  const income = ts
    .filter(t => t.type === "income")
    .reduce((a, t) => a + t.amount, 0);
  const expense = ts
    .filter(t => t.type !== "income")
    .reduce((a, t) => a + t.amount, 0);

  return {
    income,
    expense,
    balance: state.openingBalance + income - expense
  };
}

function debtOpen() {
  return state.debts.reduce(
    (s, d) => s + Math.max(0, d.total - (d.paidAmount || 0)),
    0
  );
}

function addMonths(date, n) {
  const d = new Date(date + "T12:00:00");
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addYears(date, n) {
  const d = new Date(date + "T12:00:00");
  d.setFullYear(d.getFullYear() + n);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function recurringOccurrences() {
  const out = [];

  for (const t of state.transactions.filter(
    t => t.repeat && t.repeat !== "none"
  )) {
    let d = t.date;

    for (let i = 1; i <= 12; i++) {
      if (t.repeat === "weekly") {
        const x = new Date(d + "T12:00:00");
        x.setDate(x.getDate() + 7);
        d = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
      } else if (t.repeat === "monthly") {
        d = addMonths(t.date, i);
      } else {
        d = addYears(t.date, i);
      }

      out.push({
        ...t,
        id: t.id + "-future-" + i,
        date: d,
        status: "planned",
        isOccurrence: true,
        sourceId: t.id
      });
    }
  }

  return out;
}

function allTransactions() {
  return [...state.transactions, ...recurringOccurrences()];
}

function projected(days = 30) {
  const end = new Date();
  end.setDate(end.getDate() + days);

  const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;

  return currentTotals().balance +
    allTransactions()
      .filter(t =>
        t.status === "planned" &&
        t.date >= today() &&
        t.date <= endStr
      )
      .reduce(
        (s, t) => s + (t.type === "income" ? t.amount : -t.amount),
        0
      );
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function itemHTML(t, allowPaid = true) {
  const sign = t.type === "income" ? "+" : "−";
  const cls = t.type === "income" ? "pos" : "neg";
  const typ = {
    income: "Entrada",
    expense: "Gasto",
    debt: "Pagamento de dívida"
  }[t.type] || t.type;

  return `<div class="item">
    <div class="item-main">
      <div class="item-title">${escapeHtml(t.description)}</div>
      <div class="item-sub">${fmtDate(t.date)} · ${typ}${t.category ? " · " + escapeHtml(t.category) : ""}</div>
      <span class="pill">${t.status === "paid" ? "Confirmado / pago" : "Previsto"}${t.repeat && t.repeat !== "none" ? " · Recorrente" : ""}${t.isOccurrence ? " · Repetição" : ""}</span>
    </div>
    <div style="text-align:right">
      <div class="amount ${cls}">${sign} ${money(t.amount)}</div>
      <div class="form-actions" style="justify-content:flex-end;margin-top:8px">
        ${t.status !== "paid" && allowPaid ? `<button class="btn-light" onclick="markPaid('${t.id}')">Pagar</button>` : ""}
        ${!t.isOccurrence ? `<button class="btn-muted" onclick="deleteTransaction('${t.id}')">Excluir</button>` : ""}
      </div>
    </div>
  </div>`;
}

function render() {
  const totals = currentTotals();

  $("currentBalance").textContent = money(totals.balance);
  $("incomeTotal").textContent = money(totals.income);
  $("expenseTotal").textContent = money(totals.expense);
  $("debtTotal").textContent = money(debtOpen());
  $("projectedBalance").textContent = money(projected(30));
  $("openingBalance").value = String(state.openingBalance).replace(".", ",");

  const future = allTransactions()
    .filter(t => t.status === "planned" && t.date >= today())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  $("upcomingList").innerHTML = future.length
    ? future.map(t => itemHTML(t)).join("")
    : '<div class="empty">Nenhuma conta futura cadastrada.</div>';

  const recent = [...state.transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  $("recentList").innerHTML = recent.length
    ? recent.map(t => itemHTML(t, false)).join("")
    : '<div class="empty">Seus lançamentos aparecerão aqui.</div>';

const filtered = [...allTransactions()]
  .filter(t => filter === "all" || t.type === filter)
  .sort((a, b) => {
    const dataA = new Date(a.date + "T00:00:00").getTime();
    const dataB = new Date(b.date + "T00:00:00").getTime();
    return dataB - dataA;
  });

  $("transactionsList").innerHTML = filtered.length
    ? filtered.map(t => itemHTML(t)).join("")
    : '<div class="empty">Nenhum lançamento nesta categoria.</div>';

  $("debtsList").innerHTML = state.debts.length
    ? state.debts.map(d => `<div class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(d.name)}</div>
          <div class="item-sub">Vencimento: ${fmtDate(d.dueDate)}${d.installments > 1 ? " · " + d.installments + " parcelas" : ""}</div>
          <span class="pill">Total ${money(d.total)} · Pago ${money(d.paidAmount || 0)}</span>
        </div>
        <div class="amount">${money(Math.max(0, d.total - (d.paidAmount || 0)))}</div>
        <button class="btn-light" onclick="payDebt('${d.id}')">Pagar</button>
        <button class="btn-muted" onclick="deleteDebt('${d.id}')">Excluir</button>
      </div>`).join("")
    : '<div class="empty">Nenhuma dívida cadastrada.</div>';

  $("planningList").innerHTML = future.length
    ? future.map(t => itemHTML(t)).join("")
    : '<div class="empty">Cadastre previsões para visualizar seu planejamento.</div>';
}

function showView(name, btn) {
  document.querySelectorAll("main section").forEach(s => s.classList.add("hidden"));
  $("view-" + name).classList.remove("hidden");
  document.querySelectorAll("nav button").forEach(b =>
    b.classList.toggle("active", b === btn)
  );
  render();
}

function filterTransactions(f) {
  filter = f;
  render();
}

function openForm(kind) {
  editingId = null;
  $("entryForm").reset();
  $("fDate").value = today();
  $("fStatus").value = "planned";
  $("fType").value = kind === "debt" ? "debt" : "expense";
  $("formTitle").textContent =
    kind === "debt" ? "Novo pagamento de dívida" : "Novo lançamento";
  $("modal").classList.remove("hidden");
}

function closeForm() {
  $("modal").classList.add("hidden");
}

$("entryForm").addEventListener("submit", e => {
  e.preventDefault();

  const amount = parseMoney($("fAmount").value);

  if (amount <= 0) {
    alert("Informe um valor maior que zero.");
    return;
  }

  const t = {
    id: uid(),
    description: $("fDescription").value.trim(),
    type: $("fType").value,
    amount,
    date: $("fDate").value,
    status: $("fStatus").value,
    repeat: $("fRepeat").value,
    category: $("fCategory").value.trim(),
    createdAt: new Date().toISOString()
  };

  if (!t.description || !t.date) return;

  state.transactions.push(t);
  saveLocal();
  closeForm();
});

function markPaid(id) {
  const t = state.transactions.find(x => x.id === id);

  if (!t) {
    alert("Esta ocorrência recorrente é uma previsão gerada. Para registrá-la como paga, cadastre o pagamento como lançamento confirmado.");
    return;
  }

  if (t.status === "paid") return;

  t.status = "paid";
  saveLocal();
}

function deleteTransaction(id) {
  if (!confirm("Excluir este lançamento?")) return;

  state.transactions = state.transactions.filter(t => t.id !== id);
  saveLocal();
}

function saveOpeningBalance() {
  state.openingBalance = parseMoney($("openingBalance").value);
  saveLocal();
  alert("Saldo inicial salvo.");
}

function payDebt(id) {
  const d = state.debts.find(x => x.id === id);
  if (!d) return;

  const raw = prompt(
    `Quanto você pagou da dívida "${d.name}"? Saldo em aberto: ${money(d.total - (d.paidAmount || 0))}`
  );

  if (raw === null) return;

  const amount = parseMoney(raw);

  if (amount <= 0 || amount > d.total - (d.paidAmount || 0)) {
    alert("Informe um valor positivo que não ultrapasse o saldo em aberto.");
    return;
  }

  d.paidAmount = (d.paidAmount || 0) + amount;

  state.transactions.push({
    id: uid(),
    description: "Pagamento: " + d.name,
    type: "debt",
    amount,
    date: today(),
    status: "paid",
    repeat: "none",
    category: "Dívida",
    createdAt: new Date().toISOString()
  });

  saveLocal();
}

function deleteDebt(id) {
  if (!confirm("Excluir esta dívida do cadastro? Lançamentos já feitos não serão apagados.")) return;

  state.debts = state.debts.filter(d => d.id !== id);
  saveLocal();
}

function addDebt() {
  const name = prompt("Nome da dívida / credor:");
  if (!name) return;

  const total = parseMoney(prompt("Valor total da dívida (R$):"));

  if (total <= 0) {
    alert("Valor inválido.");
    return;
  }

  const dueDate = prompt("Data do próximo vencimento (AAAA-MM-DD):", today());

  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    alert("Data inválida.");
    return;
  }

  const installments = Math.max(
    1,
    parseInt(prompt("Número total de parcelas:", "1") || "1", 10)
  );

  const debt = {
    id: uid(),
    name: name.trim(),
    total,
    dueDate,
    installments,
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };

  state.debts.push(debt);

  if (installments > 1) {
    const each = Math.round((total / installments) * 100) / 100;

    for (let i = 0; i < installments; i++) {
      state.transactions.push({
        id: uid(),
        description: `${name.trim()} — parcela ${i + 1}/${installments}`,
        type: "debt",
        amount: i === installments - 1
          ? Math.round((total - each * (installments - 1)) * 100) / 100
          : each,
        date: addMonths(dueDate, i),
        status: "planned",
        repeat: "none",
        category: "Dívida",
        debtId: debt.id,
        createdAt: new Date().toISOString()
      });
    }
  }

  saveLocal();
}

function exportBackup() {
  const blob = new Blob(
    [JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)],
    { type: "application/json" }
  );

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `meu-financeiro-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importBackup(e) {
  const f = e.target.files[0];
  if (!f) return;

  const r = new FileReader();

  r.onload = () => {
    try {
      const x = JSON.parse(r.result);

      if (!Array.isArray(x.transactions) || !Array.isArray(x.debts)) {
        throw Error();
      }

      if (!confirm("Importar vai substituir os dados atuais deste aparelho. Continuar?")) return;

      state = { ...blank(), ...x };
      saveLocal();
      alert("Backup importado.");
    } catch {
      alert("Arquivo de backup inválido.");
    }
  };

  r.readAsText(f);
  e.target.value = "";
}

function resetApp() {
  if (!confirm("Apagar TODOS os dados deste aparelho? Exporte um backup antes. Esta ação é irreversível.")) return;

  localStorage.removeItem(DBKEY);
  state = blank();
  saveLocal();
  alert("Dados apagados.");
}

function configLoad() {
  let c = JSON.parse(localStorage.getItem(CLOUDKEY) || "{}");
  $("supabaseUrl").value = c.url || "";
  $("supabaseKey").value = c.key || "";
}

function configureCloud() {
  state.cloud = {
    url: $("supabaseUrl").value.trim(),
    key: $("supabaseKey").value.trim()
  };

  localStorage.setItem(CLOUDKEY, JSON.stringify(state.cloud));
  initSupabase();

  $("cloudMessage").textContent =
    "Configuração salva neste navegador. Agora crie uma conta ou entre para sincronizar.";
}

function initSupabase() {
  if (!state.cloud?.url || !state.cloud?.key || !window.supabase) {
    supabaseClient = null;
    return null;
  }

  supabaseClient = window.supabase.createClient(
    state.cloud.url,
    state.cloud.key
  );

  return supabaseClient;
}

async function cloudSignUp() {
  configureCloud();

  const c = initSupabase();

  if (!c) {
    alert("Informe URL e chave pública do Supabase.");
    return;
  }

  const { error } = await c.auth.signUp({
    email: $("syncEmail").value,
    password: $("syncPassword").value
  });

  $("cloudMessage").textContent = error
    ? error.message
    : "Conta criada. Se a confirmação por e-mail estiver ativa, confirme o endereço e depois entre.";
}

async function cloudSignIn() {
  configureCloud();

  const c = initSupabase();

  if (!c) {
    alert("Informe URL e chave pública do Supabase.");
    return;
  }

  const { data, error } = await c.auth.signInWithPassword({
    email: $("syncEmail").value,
    password: $("syncPassword").value
  });

  if (error) {
    $("cloudMessage").textContent = error.message;
    return;
  }

  cloudUser = data.user;
  $("cloudMessage").textContent = "Conectado. Verificando backup na nuvem…";

  await pullCloud();
  await pushCloud();
  updateSyncBadge();
}

async function cloudSignOut() {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }

  cloudUser = null;
  $("cloudMessage").textContent = "Você saiu da conta na nuvem.";
  updateSyncBadge();
}

async function pullCloud() {
  if (!supabaseClient || !cloudUser) return;

  const { data, error } = await supabaseClient
    .from("finance_backups")
    .select("payload,updated_at")
    .eq("user_id", cloudUser.id)
    .maybeSingle();

  if (error) {
    $("cloudMessage").textContent = "Falha ao ler backup: " + error.message;
    return;
  }

  if (data?.payload) {
    const remote = data.payload;
    const localDate = state.lastCloudSync || "";
    const remoteDate = data.updated_at || "";

    if (
      !state.transactions.length &&
      !state.debts.length &&
      (!state.lastCloudSync || remoteDate > localDate)
    ) {
      state = { ...blank(), ...remote };
      localStorage.setItem(DBKEY, JSON.stringify(state));
      render();
    } else if (
      remoteDate > localDate &&
      confirm("Há um backup na nuvem mais recente.\nSubstituir os dados deste aparelho pelo backup da nuvem?")
    ) {
      state = { ...blank(), ...remote };
      localStorage.setItem(DBKEY, JSON.stringify(state));
      render();
    }
  }
}

async function pushCloud() {
  if (!supabaseClient || !cloudUser || syncing) return;

  syncing = true;

  try {
    const payload = {
      ...state,
      cloud: undefined,
      lastCloudSync: new Date().toISOString()
    };

    const { error } = await supabaseClient
      .from("finance_backups")
      .upsert(
        {
          user_id: cloudUser.id,
          payload,
          updated_at: new Date().toISOString()
        },
        { onConflict: "user_id" }
      );

    if (error) {
      $("cloudMessage").textContent = "Erro ao sincronizar: " + error.message;
    } else {
      state.lastCloudSync = new Date().toISOString();
      localStorage.setItem(DBKEY, JSON.stringify(state));
      $("cloudMessage").textContent =
        "Backup sincronizado em " + new Date().toLocaleString("pt-BR");
      updateSyncBadge();
    }
  } finally {
    syncing = false;
  }
}

function scheduleCloudSync() {
  if (!cloudUser || !supabaseClient) return;

  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushCloud, 900);
}

function updateSyncBadge() {
  $("syncBadge").textContent = cloudUser
    ? "☁ Sincronizado"
    : "Somente neste aparelho";
}

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker
    .register("./service-worker.js")
    .catch(() => {});
}

window.addEventListener("online", () => {
  if (cloudUser) pushCloud();
});

// Disponibiliza as funções chamadas pelos controles do HTML.
window.showView = showView;
window.openForm = openForm;
window.closeForm = closeForm;
window.filterTransactions = filterTransactions;
window.markPaid = markPaid;
window.deleteTransaction = deleteTransaction;
window.saveOpeningBalance = saveOpeningBalance;
window.payDebt = payDebt;
window.deleteDebt = deleteDebt;
window.addDebt = addDebt;
window.exportBackup = exportBackup;
window.importBackup = importBackup;
window.resetApp = resetApp;
window.configureCloud = configureCloud;
window.cloudSignUp = cloudSignUp;
window.cloudSignIn = cloudSignIn;
window.cloudSignOut = cloudSignOut;

document.querySelector('[data-view="debts"]').addEventListener("dblclick", addDebt);
document.querySelector("#view-debts .section-head button").onclick = addDebt;

configLoad();
initSupabase();
render();

function atualizarCoresFinanceiras() {
  const campos = [
    "currentBalance",
    "debtTotal",
    "projectedBalance"
  ];

  campos.forEach((id) => {
    const elemento = document.getElementById(id);
    if (!elemento) return;

    const texto = elemento.textContent.trim();

    // Converte valores como R$ 1.234,56 ou -R$ 1.234,56
    const numeroTexto = texto
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");

    const valor = Number(numeroTexto);

    elemento.classList.remove("pos", "neg");

    if (!Number.isFinite(valor) || valor === 0) {
      return;
    }

    elemento.classList.add(valor > 0 ? "pos" : "neg");
  });
}

// Atualiza as cores quando os valores exibidos mudarem.
function observarCoresFinanceiras() {
  atualizarCoresFinanceiras();

  const observador = new MutationObserver(() => {
    atualizarCoresFinanceiras();
  });

  ["currentBalance", "debtTotal", "projectedBalance"]
    .forEach((id) => {
      const elemento = document.getElementById(id);

      if (elemento) {
        observador.observe(elemento, {
          childList: true,
          characterData: true,
          subtree: true
        });
      }
    });
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    observarCoresFinanceiras
  );
} else {
  observarCoresFinanceiras();
}
