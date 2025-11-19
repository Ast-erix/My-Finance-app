/* app.js - PWA + IndexedDB + SHA-256 login + catálogo + carteira + transações
   Atualizado: IDs com crypto.randomUUID, preco opcional, export/import backup,
   normalização tipos, melhor tratamento de erros. */

const DB_NAME = 'myfinance-db';
const DB_VERSION = 1;
const STORE_USERS = 'users';
let dbInstance = null;

async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_USERS)) {
        const store = db.createObjectStore(STORE_USERS, { keyPath: 'nickname' });
        store.createIndex('nickname', 'nickname', { unique: true });
      }
    };
    req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
    req.onerror = (e) => reject(e.target.error);
  });
}
async function getDB(){ if(!dbInstance) await openDB(); return dbInstance; }

async function getUser(nickname){
  try {
    const db = await getDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_USERS, 'readonly');
      const store = tx.objectStore(STORE_USERS);
      const req = store.get(nickname);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  } catch(e) {
    console.error('getUser error', e);
    return null;
  }
}
async function putUser(userObj){
  try {
    const db = await getDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_USERS, 'readwrite');
      const store = tx.objectStore(STORE_USERS);
      const req = store.put(userObj);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  } catch(e){
    console.error('putUser error', e);
    throw e;
  }
}

/* ---------- SHA-256 util ---------- */
async function sha256Hex(text){
  const enc = new TextEncoder();
  const data = enc.encode(String(text));
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* ---------- App state ---------- */
let usuarioAtivo = null;
let cacheUser = null;

/* ---------- Payment map (label -> key) ---------- */
const PAYMENT_MAP = {
  "Crédito":"credito", "Crédito ":"credito",
  "Débito":"debito", "Débito ":"debito",
  "Cartão - Crédito":"credito", "Cartão - Débito":"debito",
  "Vale Refeição":"vr", "Vale Alimentação":"va", "Vale Transporte":"vt",
  "Dinheiro":"dinheiro", "dinheiro":"dinheiro"
};

/* ---------- startup bindings ---------- */
document.addEventListener('DOMContentLoaded', () => {
  safeBind('btnCriarConta','click', criarContaHandler);
  safeBind('btnLogin','click', loginHandler);
  safeBind('novo-item','keydown', handleNovoItem);
  safeBind('btnHasBackup','click', openImportModal);
  safeBind('btnExportBackup','click', exportBackup);
  safeBind('btnLogout','click', logout);

  // initialize DB
  (async ()=>{ await getDB(); })();
});

function safeBind(id, evt, fn){
  const el = document.getElementById(id);
  if(el) el.addEventListener(evt, fn);
}

/* ---------- Auth handlers ---------- */
async function criarContaHandler(){
  const nickEl = document.getElementById('nickname');
  const senhaEl = document.getElementById('senha');
  const nick = nickEl ? nickEl.value.trim() : '';
  const senha = senhaEl ? senhaEl.value.trim() : '';
  if(!nick || !senha) return alert('Preencha nickname e senha');
  const exists = await getUser(nick);
  if(exists) return alert('Nickname já existe');
  const hash = await sha256Hex(senha);
  const userObj = {
    nickname: nick,
    senhaHash: hash,
    transacoes: [],
    catalogo: [],
    carteira: { credito:0, debito:0, vr:0, va:0, vt:0, dinheiro:0 },
    meta: {}
  };
  try {
    await putUser(userObj);
    alert('Conta criada! Faça login.');
    if(senhaEl) senhaEl.value = '';
  } catch(e){
    console.error(e); alert('Erro ao criar conta');
  }
}

async function loginHandler(){
  const nickEl = document.getElementById('nickname');
  const senhaEl = document.getElementById('senha');
  const nick = nickEl ? nickEl.value.trim() : '';
  const senha = senhaEl ? senhaEl.value.trim() : '';
  if(!nick || !senha) return alert('Preencha nickname e senha');
  const user = await getUser(nick);
  if(!user) return alert('Usuário não encontrado');
  const hash = await sha256Hex(senha);
  if(hash !== user.senhaHash) return alert('Senha incorreta');
  usuarioAtivo = nick;
  cacheUser = user;
  // show app
  const loginScreen = document.querySelector('.login-screen');
  if(loginScreen) loginScreen.style.display = 'none';
  const appMain = document.getElementById('app-principal');
  if(appMain) appMain.style.display = 'flex';
  // show export button if exists
  const btnExport = document.getElementById('btnExportBackup');
  if(btnExport) btnExport.style.display = 'inline-block';
  await carregarInterface();
}

function logout(){
  usuarioAtivo = null; cacheUser = null;
  const appMain = document.getElementById('app-principal');
  if(appMain) appMain.style.display = 'none';
  const loginScreen = document.querySelector('.login-screen');
  if(loginScreen) loginScreen.style.display = 'flex';
  const nickEl = document.getElementById('nickname');
  const senhaEl = document.getElementById('senha');
  if(nickEl) nickEl.value = '';
  if(senhaEl) senhaEl.value = '';
  const btnExport = document.getElementById('btnExportBackup');
  if(btnExport) btnExport.style.display = 'none';
}

/* ---------- salvar usuário ---------- */
async function salvarUsuario(){
  if(!cacheUser) { console.warn('salvarUsuario: sem cacheUser'); return; }
  try {
    await putUser(cacheUser);
  } catch(e){
    console.error('Erro ao salvar usuario', e);
    alert('Erro ao salvar dados');
  }
}

/* ---------- formatação R$ ---------- */
function formatarInputR$(input){
  if(!input) return;
  let v = String(input.value).replace(/\D/g,'');
  if(!v){ input.value=''; return; }
  v = (Number(v)/100).toFixed(2).replace('.',',');
  input.value = 'R$ '+v;
  input.selectionStart = input.selectionEnd = input.value.length;
}
function formatarValorNumber(num){
  const n = (typeof num === 'number') ? num : (Number(num) || 0);
  return n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}

/* ---------- transações ---------- */
function mostrarFormulario(tipo){
  const f = document.getElementById('formulario');
  if(!f) return;
  f.style.display = 'block';
  document.getElementById('tituloFormulario').textContent = tipo === 'receita' ? 'Nova Receita' : 'Nova Despesa';
}
function fecharFormulario(){
  const f = document.getElementById('formulario');
  if(f) f.style.display = 'none';
  const d = document.getElementById('descricao'); if(d) d.value='';
  const v = document.getElementById('valor'); if(v) v.value='';
  const m = document.getElementById('meio-pagamento'); if(m) m.value='credito';
}
async function adicionarTransacao(){
  const descEl = document.getElementById('descricao');
  const valorEl = document.getElementById('valor');
  const meioEl = document.getElementById('meio-pagamento');
  const desc = descEl ? descEl.value.trim() : '';
  const valorRaw = valorEl ? String(valorEl.value).replace(/\D/g,'') : '';
  const meio = meioEl ? meioEl.value : 'dinheiro';

  if(!desc || !valorRaw) return alert('Preencha corretamente');
  const valor = Number(valorRaw)/100;
  const tipo = document.getElementById('tituloFormulario').textContent.includes('Despesa') ? 'despesa' : 'receita';
  const trans = { id: crypto.randomUUID(), descricao: desc, valor, tipo, meio, createdAt: Date.now() };
  cacheUser.transacoes = cacheUser.transacoes || [];
  cacheUser.transacoes.push(trans);
  if(cacheUser.carteira[meio] === undefined) cacheUser.carteira[meio] = 0;
  cacheUser.carteira[meio] += tipo === 'receita' ? valor : -valor;
  await salvarUsuario();
  await carregarInterface();
  fecharFormulario();
}
async function apagarTransacao(id){
  cacheUser.transacoes = (cacheUser.transacoes || []).filter(t => t.id !== id);
  await salvarUsuario();
  await carregarInterface();
}

/* ---------- catálogo ---------- */
async function handleNovoItem(e){
  if(e.key === 'Enter'){
    const nome = e.target.value.trim();
    if(!nome) return;
    cacheUser.catalogo = cacheUser.catalogo || [];
    cacheUser.catalogo.push({ nome, preco:null, tipo:'dinheiro', quantidade:1, meta:'', valorExibido:'unitario' });
    e.target.value = '';
    await salvarUsuario();
    carregarCatalogo();
  }
}
function carregarCatalogo(){
  const list = document.getElementById('catalogo-lista');
  if(!list) return;
  list.innerHTML = '';
  (cacheUser.catalogo || []).forEach((item, idx) => {
    const div = document.createElement('div');
    // preco pode ser null
    const preco = (item.preco === null || item.preco === undefined) ? null : Number(item.preco);
    const quantidade = Number(item.quantidade || 1);
    const showValue = (item.valorExibido === 'unitario') ? preco : (preco !== null ? preco * quantidade : null);
    const showText = (showValue === null) ? '—' : formatarValorNumber(showValue);
    div.innerHTML = `<span>${item.nome}</span>
      <div>
        <span class="btn-dinheiro" title="${showText}">💰 ${showText}</span>
        <button class="btn-editar" onclick="abrirPopup(${idx})">✏️</button>
      </div>`;
    list.appendChild(div);
  });
}

/* popup catálogo */
let idxEdit = null;
function abrirPopup(i){
  idxEdit = i;
  const item = (cacheUser.catalogo || [])[i];
  if(!item) return;
  document.getElementById('item-nome').textContent = item.nome;
  // map internal tipo back to readable label if possible
  const label = Object.keys(PAYMENT_MAP).find(k => PAYMENT_MAP[k] === (item.tipo || 'dinheiro')) || 'Dinheiro';
  const tipoEl = document.getElementById('item-tipo');
  if(tipoEl) tipoEl.value = label;
  document.getElementById('item-preco').value = item.preco ? ('R$ '+Number(item.preco).toFixed(2).replace('.',',')) : '';
  document.getElementById('item-quantidade').value = item.quantidade || 1;
  document.getElementById('item-valor-exibido').value = item.valorExibido || 'unitario';
  document.getElementById('item-meta').value = item.meta || '';
  document.getElementById('popup-detalhes').style.display = 'block';
}
async function fecharPopup(){
  const p = document.getElementById('popup-detalhes');
  if(p) p.style.display = 'none';
  idxEdit = null;
}
async function salvarDetalhes(){
  if(idxEdit === null) return;
  const it = cacheUser.catalogo[idxEdit];
  if(!it) return;
  const tipoLabel = document.getElementById('item-tipo').value;
  it.tipo = PAYMENT_MAP[tipoLabel] || 'dinheiro';
  const precoStr = document.getElementById('item-preco').value.replace(/\D/g,'');
  it.preco = precoStr ? Number(precoStr)/100 : null; // allow null intentionally
  it.quantidade = Number(document.getElementById('item-quantidade').value) || 1;
  it.valorExibido = document.getElementById('item-valor-exibido').value;
  it.meta = document.getElementById('item-meta').value;
  await salvarUsuario();
  carregarCatalogo();
  fecharPopup();
}

/* ---------- carteira ---------- */
function carregarCarteira(){
  const div = document.getElementById('carteira-lista');
  if(!div) return;
  div.innerHTML = '';
  const cart = cacheUser.carteira || { credito:0, debito:0, vr:0, va:0, vt:0, dinheiro:0 };
  for(let k of ['credito','debito','vr','va','vt','dinheiro']){
    const el = document.createElement('div');
    const name = { credito:'Crédito', debito:'Débito', vr:'VR', va:'VA', vt:'VT', dinheiro:'Dinheiro' }[k];
    el.innerHTML = `<div>${name}<span>${formatarValorNumber(cart[k])}</span></div>`;
    div.appendChild(el);
  }
}

/* ---------- UI carregar / mostrar transações / saldo ---------- */
async function carregarInterface(){
  if(!usuarioAtivo) return alert('Nenhum usuário ativo');
  cacheUser = await getUser(usuarioAtivo);
  if(!cacheUser) return alert('Erro ao carregar usuário');
  carregarTransacoesUI();
  carregarCatalogo();
  carregarCarteira();
  atualizarSaldoUI();
}
function carregarTransacoesUI(){
  const list = document.getElementById('lista');
  if(!list) return;
  list.innerHTML = '';
  (cacheUser.transacoes || []).slice().reverse().forEach(t => {
    const card = document.createElement('div');
    card.className = 'card-transacao';
    const idAttr = t.id ? `'${t.id}'` : t.id;
    card.innerHTML = `<span>${t.descricao} <small>(${t.meio})</small></span>
      <div>
        <strong>${formatarValorNumber(t.valor)}</strong>
        <button class="btn-apagar" onclick="apagarTransacao(${idAttr})">Apagar</button>
      </div>`;
    list.appendChild(card);
  });
}
function atualizarSaldoUI(){
  const total = (cacheUser.transacoes || []).reduce((acc,t)=>acc + (t.tipo === 'receita' ? t.valor : -t.valor), 0);
  const saldoEl = document.getElementById('saldo');
  if(saldoEl) saldoEl.textContent = formatarValorNumber(total);
}

/* ---------- placeholder ---------- */
function abrirSecao(s){ alert('Seção '+s+' ainda não implementada'); }

/* ---------- BACKUP / IMPORT (backfinance) ---------- */

/* export current user as backfinance-<nick>.json */
function exportBackup(){
  if(!cacheUser) return alert('Faça login para exportar o backup');
  try {
    const exportObj = JSON.parse(JSON.stringify(cacheUser));
    const data = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backfinance-${exportObj.nickname || 'backup'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch(e){
    console.error('exportBackup error', e);
    alert('Erro ao exportar backup');
  }
}

/* open import modal if exists, else fallback to prompt file selection */
function openImportModal(){
  const modal = document.getElementById('modal-import');
  if(modal){
    modal.style.display = 'flex';
    const fileInput = document.getElementById('input-backfile');
    if(fileInput) fileInput.value = '';
    const nickInput = document.getElementById('import-nickname');
    if(nickInput) nickInput.value = '';
    const passInput = document.getElementById('import-senha');
    if(passInput) passInput.value = '';
    return;
  }
  // fallback: file prompt via input element created on the fly
  const fi = document.createElement('input');
  fi.type = 'file';
  fi.accept = '.json,application/json';
  fi.onchange = async (e) => {
    const f = e.target.files[0];
    if(!f) return;
    await handleImportWorkflow(f);
  };
  fi.click();
}

/* read file into object */
function readBackupFile(file){
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      try{ res(JSON.parse(fr.result)); } catch(err){ rej(err); }
    };
    fr.onerror = () => rej(fr.error);
    fr.readAsText(file, 'utf-8');
  });
}

/* import workflow - allows creating new password even if backup has hash */
async function handleImportWorkflow(file){
  let backup;
  try { backup = await readBackupFile(file); } catch(e){ console.error(e); return alert('Arquivo inválido'); }

  // if modal exists, read nickname/senha from inputs; else prompt
  const nickInput = document.getElementById('import-nickname');
  const passInput = document.getElementById('import-senha');
  const nick = (nickInput && nickInput.value.trim()) || prompt('Nickname para restaurar:') || '';
  const senha = (passInput && passInput.value.trim()) || prompt('Nova senha para essa conta:') || '';
  if(!nick || !senha) return alert('Nickname e senha são obrigatórios para restaurar');

  const novaHash = await sha256Hex(senha);

  // allow restore even if backup had different hash: set new hash
  backup.nickname = nick;
  backup.senhaHash = novaHash;
  backup.transacoes = backup.transacoes || [];
  backup.catalogo = backup.catalogo || [];
  backup.carteira = backup.carteira || { credito:0, debito:0, vr:0, va:0, vt:0, dinheiro:0 };

  try {
    await putUser(backup);
    alert('Backup importado com sucesso. Faça login com o nickname e a nova senha.');
    // close modal if present
    const modal = document.getElementById('modal-import');
    if(modal) modal.style.display = 'none';
  } catch(e){
    console.error('import error', e);
    alert('Erro ao importar backup');
  }
}