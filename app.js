/* app.js - PWA + IndexedDB + SHA-256 login + catálogo + carteira + transações */

/* ---------- IndexedDB helper ---------- */
const DB_NAME = 'myfinance-db';
const DB_VERSION = 1;
const STORE_USERS = 'users';
let dbInstance = null;

function openDB() {
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
  const db = await getDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_USERS, 'readonly');
    const store = tx.objectStore(STORE_USERS);
    const req = store.get(nickname);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function putUser(userObj){
  const db = await getDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_USERS, 'readwrite');
    const store = tx.objectStore(STORE_USERS);
    const req = store.put(userObj);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/* ---------- SHA-256 util ---------- */
async function sha256Hex(text){
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* ---------- App state ---------- */
let usuarioAtivo = null;
let cacheUser = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnCriarConta').addEventListener('click', criarContaHandler);
  document.getElementById('btnLogin').addEventListener('click', loginHandler);
  document.getElementById('novo-item').addEventListener('keydown', handleNovoItem);
  // initialize DB
  (async ()=>{ await getDB(); })();
});

/* ---------- Auth handlers ---------- */
async function criarContaHandler(){
  const nick = document.getElementById('nickname').value.trim();
  const senha = document.getElementById('senha').value.trim();
  if(!nick || !senha) return alert('Preencha nickname e senha');
  const exists = await getUser(nick);
  if(exists) return alert('Nickname já existe');
  const hash = await sha256Hex(senha);
  const userObj = { nickname: nick, senhaHash: hash, transacoes: [], catalogo: [], carteira: { credito:0, debito:0, vr:0, va:0, vt:0, dinheiro:0 } };
  await putUser(userObj);
  alert('Conta criada! Faça login.');
  document.getElementById('senha').value = '';
}
async function loginHandler(){
  const nick = document.getElementById('nickname').value.trim();
  const senha = document.getElementById('senha').value.trim();
  if(!nick || !senha) return alert('Preencha nickname e senha');
  const user = await getUser(nick);
  if(!user) return alert('Usuário não encontrado');
  const hash = await sha256Hex(senha);
  if(hash !== user.senhaHash) return alert('Senha incorreta');
  usuarioAtivo = nick;
  cacheUser = user;
  document.querySelector('.login-screen').style.display = 'none';
  document.getElementById('app-principal').style.display = 'flex';
  carregarInterface();
}
function logout(){
  usuarioAtivo = null; cacheUser = null;
  document.getElementById('app-principal').style.display = 'none';
  document.querySelector('.login-screen').style.display = 'flex';
  document.getElementById('nickname').value = '';
  document.getElementById('senha').value = '';
}

/* ---------- salvar usuário ---------- */
async function salvarUsuario(){
  if(!cacheUser) return;
  await putUser(cacheUser);
}

/* ---------- formatação R$ ---------- */
function formatarInputR$(input){
  let v = input.value.replace(/\D/g,'');
  if(!v){ input.value=''; return; }
  v = (Number(v)/100).toFixed(2).replace('.',',');
  input.value = 'R$ '+v;
  input.selectionStart = input.selectionEnd = input.value.length;
}
function formatarValorNumber(num){
  return num.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}

/* ---------- transações ---------- */
function mostrarFormulario(tipo){
  document.getElementById('formulario').style.display = 'block';
  document.getElementById('tituloFormulario').textContent = tipo === 'receita' ? 'Nova Receita' : 'Nova Despesa';
}
function fecharFormulario(){
  document.getElementById('formulario').style.display = 'none';
  document.getElementById('descricao').value='';
  document.getElementById('valor').value='';
  document.getElementById('meio-pagamento').value='credito';
}
async function adicionarTransacao(){
  const desc = document.getElementById('descricao').value.trim();
  let valorStr = document.getElementById('valor').value.replace(/\D/g,'');
  const meio = document.getElementById('meio-pagamento').value;
  if(!desc || !valorStr) return alert('Preencha corretamente');
  const valor = Number(valorStr)/100;
  const tipo = document.getElementById('tituloFormulario').textContent.includes('Despesa') ? 'despesa' : 'receita';
  const trans = { id: Date.now(), descricao: desc, valor, tipo, meio };
  cacheUser.transacoes.push(trans);
  if(cacheUser.carteira[meio] === undefined) cacheUser.carteira[meio] = 0;
  cacheUser.carteira[meio] += tipo === 'receita' ? valor : -valor;
  await salvarUsuario();
  await carregarInterface();
  fecharFormulario();
}
async function apagarTransacao(id){
  cacheUser.transacoes = cacheUser.transacoes.filter(t => t.id !== id);
  await salvarUsuario();
  await carregarInterface();
}

/* ---------- catálogo ---------- */
async function handleNovoItem(e){
  if(e.key === 'Enter'){
    const nome = e.target.value.trim();
    if(!nome) return;
    cacheUser.catalogo.push({ nome, preco:0, tipo:'Dinheiro', quantidade:1, meta:'', valorExibido:'unitario' });
    e.target.value = '';
    await salvarUsuario();
    carregarCatalogo();
  }
}
function carregarCatalogo(){
  const list = document.getElementById('catalogo-lista');
  list.innerHTML = '';
  (cacheUser.catalogo || []).forEach((item, idx) => {
    const div = document.createElement('div');
    const showValue = item.valorExibido === 'unitario' ? item.preco : (item.preco * item.quantidade);
    const showText = item.preco ? formatarValorNumber(showValue) : '';
    div.innerHTML = `<span>${item.nome}</span>
      <div>
        <span class="btn-dinheiro" title="${showText}">💰 ${showText}</span>
        <button class="btn-editar" onclick="abrirPopup(${idx})">✏️</button>
      </div>`;
    list.appendChild(div);
  });
}
/* popup */
let idxEdit = null;
function abrirPopup(i){
  idxEdit = i;
  const item = cacheUser.catalogo[i];
  document.getElementById('item-nome').textContent = item.nome;
  document.getElementById('item-tipo').value = item.tipo || 'Dinheiro';
  document.getElementById('item-preco').value = item.preco ? ('R$ '+item.preco.toFixed(2).replace('.',',')) : '';
  document.getElementById('item-quantidade').value = item.quantidade || 1;
  document.getElementById('item-valor-exibido').value = item.valorExibido || 'unitario';
  document.getElementById('item-meta').value = item.meta || '';
  document.getElementById('popup-detalhes').style.display = 'block';
}
async function fecharPopup(){
  document.getElementById('popup-detalhes').style.display = 'none';
  idxEdit = null;
}
async function salvarDetalhes(){
  if(idxEdit === null) return;
  const it = cacheUser.catalogo[idxEdit];
  it.tipo = document.getElementById('item-tipo').value;
  const precoStr = document.getElementById('item-preco').value.replace(/\D/g,'');
  it.preco = precoStr ? Number(precoStr)/100 : 0;
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
  cacheUser = await getUser(usuarioAtivo);
  if(!cacheUser) return alert('Erro ao carregar usuário');
  carregarTransacoesUI();
  carregarCatalogo();
  carregarCarteira();
  atualizarSaldoUI();
}
function carregarTransacoesUI(){
  const list = document.getElementById('lista');
  list.innerHTML = '';
  (cacheUser.transacoes || []).slice().reverse().forEach(t => {
    const card = document.createElement('div');
    card.className = 'card-transacao';
    card.innerHTML = `<span>${t.descricao} <small>(${t.meio})</small></span>
      <div>
        <strong>${formatarValorNumber(t.valor)}</strong>
        <button class="btn-apagar" onclick="apagarTransacao(${t.id})">Apagar</button>
      </div>`;
    list.appendChild(card);
  });
}
function atualizarSaldoUI(){
  const total = (cacheUser.transacoes || []).reduce((acc,t)=>acc + (t.tipo === 'receita' ? t.valor : -t.valor), 0);
  document.getElementById('saldo').textContent = formatarValorNumber(total);
}

/* ---------- placeholder ---------- */
function abrirSecao(s){ alert('Seção '+s+' ainda não implementada'); }
