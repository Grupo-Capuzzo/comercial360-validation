/* app.js — Grupo Capuzzo | Condomínios de Investimento */
'use strict';

/* ── CPF mask ────────────────────────────────────────────── */
function maskCPF(el) {
  el.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 9)      v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    this.value = v;
  });
}

/* ── CPF/CNPJ mask (dinâmica) ────────────────────────────── */
/* Até 11 dígitos → 000.000.000-00 | 12 a 14 → 00.000.000/0000-00 */
function formatCpfCnpj(value) {
  var v = String(value || '').replace(/\D/g, '').slice(0, 14);
  if (v.length <= 11) {
    if (v.length > 9)      v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  } else {
    if (v.length > 12)      v = v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})/, '$1.$2.$3/$4-$5');
    else                    v = v.replace(/(\d{2})(\d{3})(\d{3})(\d{1,4})/, '$1.$2.$3/$4');
  }
  return v;
}

function maskCpfCnpj(el) {
  el.addEventListener('input', function () {
    this.value = formatCpfCnpj(this.value);
  });
  /* Formata valor já carregado (ex: edição de cadastro) */
  if (el.value) el.value = formatCpfCnpj(el.value);
}

/* ── Phone mask ──────────────────────────────────────────── */
function maskPhone(el) {
  el.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 10)      v = v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    else if (v.length > 6)  v = v.replace(/(\d{2})(\d{4,5})(\d{0,4})/, '($1) $2-$3');
    else if (v.length > 2)  v = v.replace(/(\d{2})(\d+)/, '($1) $2');
    this.value = v;
  });
}

/* ── Currency mask ───────────────────────────────────────── */
function maskCurrency(el) {
  el.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '');
    if (!v) { this.value = ''; return; }
    let num = parseInt(v, 10) / 100;
    this.value = num.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  });
}

/* ── Suggest share number via API (form de edição) ───────── */
function setupShareNumberSuggestion() {
  const condSelect = document.getElementById('condominium_id');
  const numInput   = document.getElementById('share_number');
  if (!condSelect || !numInput) return;

  condSelect.addEventListener('change', function () {
    const condId = this.value;
    if (!condId) return;
    fetch('/erp/api/sugerir-numero-cota/' + condId)
      .then(r => r.json())
      .then(data => {
        if (numInput.value === '' || numInput.dataset.autoFilled === 'true') {
          numInput.value = data.numero;
          numInput.dataset.autoFilled = 'true';
        }
      })
      .catch(() => {});
  });

  if (numInput) {
    numInput.addEventListener('input', function () {
      this.dataset.autoFilled = 'false';
    });
  }
}

/* ── Multi-share form (Nova Cota) ────────────────────────── */
function setupMultiShareForm() {
  const form       = document.getElementById('multi-share-form');
  if (!form) return;

  const condSelect  = document.getElementById('condominium_id');
  const qtyInput    = document.getElementById('quantidade');
  const valorInput  = document.getElementById('share_value');
  const valorCheck  = document.getElementById('valor_diferente');
  const numList     = document.getElementById('share-numbers-list');
  const cfgEl       = document.getElementById('multi-share-config');
  const defaultAcq  = document.getElementById('default-acq');
  const defaultLrd  = document.getElementById('default-lrd');
  const defaultMat  = document.getElementById('default-mat');
  const btnApply    = document.getElementById('btn-apply-dates');
  const statusSel   = document.getElementById('status-nova');
  if (!condSelect || !qtyInput || !valorInput || !valorCheck || !numList || !cfgEl) return;

  /* — Lê config inicial do servidor — */
  let cfg = {};
  try { cfg = JSON.parse(cfgEl.textContent); } catch(e) {}

  const initialNumbers  = cfg.initialNumbers  || [''];
  const initialValue    = cfg.initialValue    || 0;
  const initialAcqDates = cfg.initialAcqDates || [];
  const initialMatDates = cfg.initialMatDates || [];
  const initialLrdDates = cfg.initialLrdDates || [];

  /* — Formata valor inicial — */
  if (initialValue > 0) {
    valorInput.value = initialValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  }

  /* — Renderiza lista inicial — */
  renderNumberInputs(initialNumbers, null, undefined, initialAcqDates, initialLrdDates, initialMatDates);

  /* — Produto muda: busca novo padrão + sugere números — */
  condSelect.addEventListener('change', function () {
    const condId = this.value;
    if (!condId) return;
    const qty = parseInt(qtyInput.value) || 1;
    fetchSuggestions(condId, qty, true /* replace all */);
  });

  /* — Quantidade muda — */
  let qtyDebounce = null;
  qtyInput.addEventListener('input', function () {
    clearTimeout(qtyDebounce);
    qtyDebounce = setTimeout(handleQtyChange, 300);
  });
  qtyInput.addEventListener('change', handleQtyChange);

  function handleQtyChange() {
    const condId = condSelect.value;
    const newQty = parseInt(qtyInput.value) || 1;
    const currentRows = numList.querySelectorAll('.share-number-row');
    const currentQty  = currentRows.length;

    if (newQty === currentQty) return;

    if (newQty > currentQty) {
      if (condId) {
        fetchSuggestions(condId, newQty, false /* preserve existing */);
      } else {
        const baseVal = parseValue(valorInput.value);
        const defAcq  = defaultAcq ? defaultAcq.value : '';
        const defLrd  = defaultLrd ? defaultLrd.value : '';
        const defMat  = defaultMat ? defaultMat.value : '';
        for (let i = currentQty; i < newQty; i++) {
          appendRow(i + 1, '', baseVal, defAcq, defLrd, defMat);
        }
      }
    } else {
      const rows = Array.from(numList.querySelectorAll('.share-number-row'));
      for (let i = newQty; i < currentQty; i++) {
        rows[i].remove();
      }
      reindexRows();
    }
  }

  /* — Checkbox valor diferente do padrão — */
  valorCheck.addEventListener('change', function () {
    if (this.checked) {
      valorInput.removeAttribute('readonly');
      valorInput.focus();
      valorInput.select();
    } else {
      valorInput.setAttribute('readonly', '');
      const opt = condSelect.selectedOptions[0];
      const def = parseFloat(opt ? opt.dataset.defaultValue : 0) || 0;
      if (def > 0) {
        valorInput.value = def.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        applyValueToAllRows(def);
      }
    }
  });

  /* — Quando valor padrão muda (checkbox marcado), aplica a todas as linhas — */
  valorInput.addEventListener('input', function () {
    if (valorCheck.checked) {
      const v = parseValue(valorInput.value);
      if (v > 0) applyValueToAllRows(v);
    }
  });

  /* — Preencher linhas ao digitar data padrão (só se ainda vazias) — */
  function onDefaultDateInput(fieldClass) {
    return function () {
      const val = this.value;
      numList.querySelectorAll('.' + fieldClass).forEach(function (inp) {
        if (!inp.dataset.userEdited) inp.value = val;
      });
    };
  }
  if (defaultAcq) defaultAcq.addEventListener('input', onDefaultDateInput('row-acq'));
  if (defaultLrd) defaultLrd.addEventListener('input', onDefaultDateInput('row-lrd'));
  if (defaultMat) defaultMat.addEventListener('input', onDefaultDateInput('row-mat'));

  /* — Botão "Aplicar nas linhas" (sobrescreve tudo) — */
  if (btnApply) {
    btnApply.addEventListener('click', function () {
      const acq = defaultAcq ? defaultAcq.value : '';
      const lrd = defaultLrd ? defaultLrd.value : '';
      const mat = defaultMat ? defaultMat.value : '';
      numList.querySelectorAll('.row-acq').forEach(function (inp) {
        inp.value = acq;
        inp.dataset.userEdited = '';
      });
      numList.querySelectorAll('.row-lrd').forEach(function (inp) {
        inp.value = lrd;
        inp.dataset.userEdited = '';
      });
      numList.querySelectorAll('.row-mat').forEach(function (inp) {
        inp.value = mat;
        inp.dataset.userEdited = '';
      });
    });
  }

  /* — Validação no submit — */
  form.addEventListener('submit', function (e) {
    const numInputs = numList.querySelectorAll('input[name="share_numbers"]');
    const valInputs = numList.querySelectorAll('input[name="share_values"]');
    const acqInputs = numList.querySelectorAll('input[name="acquisition_dates"]');
    const matInputs = numList.querySelectorAll('input[name="maturity_dates"]');
    const lrdInputs = numList.querySelectorAll('input[name="last_renewal_dates"]');
    const isPendente = statusSel && statusSel.value === 'pendente';
    const seen = new Set();
    let ok = true;

    numInputs.forEach(function (inp, idx) {
      inp.style.borderColor = '';
      const v = inp.value.trim();
      if (!v) { markError(inp, 'Campo obrigatório.'); ok = false; }
      else if (seen.has(v)) { markError(inp, 'Número duplicado.'); ok = false; }
      seen.add(v);

      /* Valor */
      const valInp = valInputs[idx];
      if (valInp) {
        valInp.style.borderColor = '';
        if (parseValue(valInp.value) <= 0) {
          markError(valInp, 'Valor deve ser maior que zero.'); ok = false;
        }
      }

      /* Datas por linha */
      const acqInp = acqInputs[idx];
      const matInp = matInputs[idx];
      const lrdInp = lrdInputs[idx];
      const acqVal = acqInp ? acqInp.value.trim() : '';
      const matVal = matInp ? matInp.value.trim() : '';
      const lrdVal = lrdInp ? lrdInp.value.trim() : '';
      const linhaNum = idx + 1;

      if (!isPendente && !acqVal) {
        if (acqInp) markError(acqInp, 'Cota ' + linhaNum + ': aquisição obrigatória para cotas ativas.');
        ok = false;
      }
      if (acqVal && matVal && matVal < acqVal) {
        if (matInp) markError(matInp, 'Cota ' + linhaNum + ': vencimento anterior à aquisição.');
        ok = false;
      }
      if (lrdVal) {
        if (acqVal && lrdVal < acqVal) {
          if (lrdInp) markError(lrdInp, 'Cota ' + linhaNum + ': renovação anterior à aquisição.');
          ok = false;
        }
        if (matVal && lrdVal > matVal) {
          if (lrdInp) markError(lrdInp, 'Cota ' + linhaNum + ': renovação posterior ao vencimento.');
          ok = false;
        }
      }
    });

    if (!ok) {
      e.preventDefault();
      const btn = document.getElementById('btn-cadastrar');
      if (btn) { btn.textContent = '✗ Corrija os campos inválidos'; }
      setTimeout(function () {
        if (btn) btn.textContent = '✓ Cadastrar Cotas';
      }, 3000);
    }
  });

  /* ── Funções auxiliares ──────────────────────────────── */

  function fetchSuggestions(condId, qty, replaceAll) {
    fetch('/erp/api/sugerir-numeros/' + condId + '/' + qty)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        const padrao = data.valor_padrao || 0;
        if (!valorCheck.checked && padrao > 0) {
          valorInput.value = padrao.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        }
        const baseVal = valorCheck.checked ? parseValue(valorInput.value) : padrao;
        const defAcq  = defaultAcq ? defaultAcq.value : '';
        const defLrd  = defaultLrd ? defaultLrd.value : '';
        const defMat  = defaultMat ? defaultMat.value : '';
        if (replaceAll) {
          renderNumberInputs(data.numeros, null, baseVal, [], [], []);
          /* Aplica datas padrão nas novas linhas */
          if (defAcq || defLrd || defMat) applyDefaultDates(defAcq, defLrd, defMat, false);
          qtyInput.value = data.numeros.length;
        } else {
          const currentQty = numList.querySelectorAll('.share-number-row').length;
          const novos = data.numeros.slice(currentQty);
          novos.forEach(function (num, i) {
            appendRow(currentQty + i + 1, num, baseVal, defAcq, defLrd, defMat);
          });
        }
      })
      .catch(function () {});
  }

  function renderNumberInputs(numbers, values, baseVal, acqDates, lrdDates, matDates) {
    numList.innerHTML = '';
    const fallback = baseVal !== undefined ? baseVal : parseValue(valorInput.value);
    numbers.forEach(function (num, i) {
      const v   = (values && values[i] !== undefined) ? values[i] : fallback;
      const acq = (acqDates && acqDates[i]) ? acqDates[i] : '';
      const lrd = (lrdDates && lrdDates[i]) ? lrdDates[i] : '';
      const mat = (matDates && matDates[i]) ? matDates[i] : '';
      appendRow(i + 1, num || '', v, acq, lrd, mat);
    });
  }

  function appendRow(index, numVal, shareVal, acqVal, lrdVal, matVal) {
    const div = document.createElement('div');
    div.className = 'share-number-row';
    div.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:nowrap;';
    const sv = (typeof shareVal === 'number' && shareVal > 0)
      ? shareVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
    div.innerHTML =
      '<span class="share-number-index" style="color:#888;font-size:12px;min-width:52px;flex-shrink:0;">Cota ' + index + '</span>' +
      '<input type="text" name="share_numbers" value="' + escHtml(numVal) + '"' +
      ' class="form-control" style="width:120px;flex-shrink:0;" placeholder="Número" autocomplete="off" required>' +
      '<input type="text" name="share_values" value="' + escHtml(sv) + '"' +
      ' class="form-control share-value-input" style="width:130px;flex-shrink:0;" placeholder="Valor R$" autocomplete="off" required>' +
      '<input type="date" name="acquisition_dates" value="' + escHtml(acqVal || '') + '"' +
      ' class="form-control row-acq" style="width:148px;flex-shrink:0;" title="Aquisição">' +
      '<input type="date" name="last_renewal_dates" value="' + escHtml(lrdVal || '') + '"' +
      ' class="form-control row-lrd" style="width:148px;flex-shrink:0;" title="Última Renovação">' +
      '<input type="date" name="maturity_dates" value="' + escHtml(matVal || '') + '"' +
      ' class="form-control row-mat" style="width:148px;flex-shrink:0;" title="Vencimento">';
    numList.appendChild(div);

    /* Máscara de moeda */
    const valInp = div.querySelector('.share-value-input');
    if (valInp) maskCurrency(valInp);

    /* Marcar linha como editada manualmente ao alterar datas */
    ['row-acq','row-lrd','row-mat'].forEach(function (cls) {
      const el = div.querySelector('.' + cls);
      if (el) el.addEventListener('change', function () {
        this.dataset.userEdited = '1';
      });
    });
  }

  function applyDefaultDates(acq, lrd, mat, onlyEmpty) {
    numList.querySelectorAll('.row-acq').forEach(function (inp) {
      if (!onlyEmpty || !inp.value) { inp.value = acq; inp.dataset.userEdited = ''; }
    });
    numList.querySelectorAll('.row-lrd').forEach(function (inp) {
      if (!onlyEmpty || !inp.value) { inp.value = lrd; inp.dataset.userEdited = ''; }
    });
    numList.querySelectorAll('.row-mat').forEach(function (inp) {
      if (!onlyEmpty || !inp.value) { inp.value = mat; inp.dataset.userEdited = ''; }
    });
  }

  function applyValueToAllRows(val) {
    numList.querySelectorAll('.share-value-input').forEach(function (inp) {
      inp.value = val.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    });
  }

  function parseValue(s) {
    return parseFloat((s || '').replace(/\./g, '').replace(',', '.')) || 0;
  }

  function reindexRows() {
    numList.querySelectorAll('.share-number-row').forEach(function (row, i) {
      const label = row.querySelector('.share-number-index');
      if (label) label.textContent = 'Cota ' + (i + 1);
    });
  }

  function markError(inp, msg) {
    inp.style.borderColor  = '#e74c3c';
    inp.style.outlineColor = '#e74c3c';
    inp.title = msg;
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}

/* ── Auto-dismiss alerts after 5s ───────────────────────── */
function setupAlertDismiss() {
  document.querySelectorAll('.alert').forEach(el => {
    setTimeout(() => {
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 500);
    }, 5000);
  });
}

/* ── Confirm danger actions ──────────────────────────────── */
function setupConfirmForms() {
  document.querySelectorAll('[data-confirm]').forEach(el => {
    el.addEventListener('click', function (e) {
      const msg = this.dataset.confirm || 'Confirmar ação?';
      if (!confirm(msg)) e.preventDefault();
    });
  });
}

/* ── Modal helpers ───────────────────────────────────────── */
window.openModal = function (id) {
  const m = document.getElementById(id);
  if (m) { m.style.display = 'flex'; }
};

window.closeModal = function (id) {
  const m = document.getElementById(id);
  if (m) { m.style.display = 'none'; }
};

/* ── Inativar share modal ────────────────────────────────── */
/* Recebe o próprio botão (this) e lê os dados via data-* attributes,
   evitando conflito de aspas no onclick="..." inline.               */
window.openInativarModal = function (btn) {
  var shareId         = btn.dataset.shareId;
  var shareNum        = btn.dataset.shareNum;
  var clientName      = btn.dataset.clientName;
  var shareValue      = btn.dataset.shareValue;
  var acquisitionDate = btn.dataset.acquisitionDate || '';

  var numEl    = document.getElementById('modal-inativar-share-num');
  var clientEl = document.getElementById('modal-inativar-client');
  var valueEl  = document.getElementById('modal-inativar-value');
  var acqEl    = document.getElementById('modal-inativar-acq');
  var formEl   = document.getElementById('modal-inativar-form');
  var dateEl   = document.getElementById('modal-inativar-withdrawal-date');
  var noteEl   = document.getElementById('modal-inativar-user-note');
  var refEl    = document.getElementById('modal-inativar-referrer');

  if (numEl)    numEl.textContent    = shareNum;
  if (clientEl) clientEl.textContent = clientName;
  if (valueEl)  valueEl.textContent  = parseFloat(shareValue).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL'
  });
  if (acqEl)    acqEl.textContent    = acquisitionDate || '—';
  if (formEl)   formEl.action        = '/cotas/' + shareId + '/inativar';
  if (refEl)    refEl.value          = window.location.href;

  /* Limpa campos e define data mínima (não permite data antes da aquisição) */
  if (dateEl) {
    dateEl.value = '';
    dateEl.min   = acquisitionDate;
  }
  if (noteEl) noteEl.value = '';

  openModal('modal-inativar-cota');
};

/* ── Vencimentos e Retiradas: modal Renovar ──────────────── */
window.openRenovarModal = function (btn) {
  var shareId      = btn.dataset.shareId;
  var shareNum     = btn.dataset.shareNum;
  var clientName   = btn.dataset.clientName;
  var maturityDate = btn.dataset.maturityDate || '';

  var numEl    = document.getElementById('modal-renovar-share-num');
  var clientEl = document.getElementById('modal-renovar-client');
  var matEl    = document.getElementById('modal-renovar-mat');
  var formEl   = document.getElementById('modal-renovar-form');
  var refEl    = document.getElementById('modal-renovar-referrer');
  var rdEl     = document.getElementById('modal-renovar-renewal-date');
  var mdEl     = document.getElementById('modal-renovar-maturity-date');
  var noteEl   = document.getElementById('modal-renovar-user-note');

  if (numEl)    numEl.textContent    = shareNum;
  if (clientEl) clientEl.textContent = clientName;
  if (matEl)    matEl.textContent    = maturityDate || '—';
  if (formEl)   formEl.action        = '/cotas/' + shareId + '/renovar';
  if (refEl)    refEl.value          = window.location.href;

  /* Sugestões: renovação = hoje; novo vencimento = vencimento atual + 1 ano */
  var hoje = window.HOJE_ISO || new Date().toISOString().slice(0, 10);
  if (rdEl) rdEl.value = hoje;
  if (mdEl) {
    mdEl.value = '';
    if (maturityDate) {
      var d = new Date(maturityDate + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        d.setFullYear(d.getFullYear() + 1);
        mdEl.value = d.toISOString().slice(0, 10);
      }
    }
  }
  if (noteEl) noteEl.value = '';

  openModal('modal-renovar-cota');
};

/* ── Vencimentos e Retiradas: modal Marcar Retirada ──────── */
/* Sugestão: Civil = vencimento + 3 dias | Agro/Saúde = vencimento + 30 dias */
window.openRetiradaModal = function (btn) {
  var shareId      = btn.dataset.shareId;
  var shareNum     = btn.dataset.shareNum;
  var clientName   = btn.dataset.clientName;
  var condCode     = btn.dataset.condCode || '';
  var maturityDate = btn.dataset.maturityDate || '';

  var numEl    = document.getElementById('modal-retirada-share-num');
  var clientEl = document.getElementById('modal-retirada-client');
  var matEl    = document.getElementById('modal-retirada-mat');
  var formEl   = document.getElementById('modal-retirada-form');
  var refEl    = document.getElementById('modal-retirada-referrer');
  var reqEl    = document.getElementById('modal-retirada-request-date');
  var effEl    = document.getElementById('modal-retirada-effective-date');
  var notesEl  = document.getElementById('modal-retirada-notes');
  var sugEl    = document.getElementById('modal-retirada-sugestao-txt');

  if (numEl)    numEl.textContent    = shareNum;
  if (clientEl) clientEl.textContent = clientName;
  if (matEl)    matEl.textContent    = maturityDate || '—';
  if (formEl)   formEl.action        = '/cotas/' + shareId + '/marcar-retirada';
  if (refEl)    refEl.value          = window.location.href;

  var hoje = window.HOJE_ISO || new Date().toISOString().slice(0, 10);
  if (reqEl) reqEl.value = hoje;

  var days = (window.WITHDRAWAL_SUGGESTION_DAYS || {})[condCode];
  if (days === undefined) days = 30;

  var suggestion = '';
  var base = maturityDate || hoje;
  var d = new Date(base + 'T00:00:00');
  if (!isNaN(d.getTime())) {
    d.setDate(d.getDate() + days);
    suggestion = d.toISOString().slice(0, 10);
  }
  if (effEl) effEl.value = suggestion;
  if (sugEl) {
    sugEl.textContent = 'Sugestão: ' + (maturityDate ? 'vencimento' : 'hoje') +
      ' + ' + days + ' dias' + (suggestion ? ' → ' + suggestion : '') + '.';
  }
  if (notesEl) notesEl.value = '';

  openModal('modal-retirada-cota');
};

/* ── Vencimentos e Retiradas: modal Editar data efetiva ──── */
window.openEditarDataModal = function (btn) {
  var shareId       = btn.dataset.shareId;
  var shareNum      = btn.dataset.shareNum;
  var effectiveDate = btn.dataset.effectiveDate || '';

  var numEl  = document.getElementById('modal-editar-data-share-num');
  var formEl = document.getElementById('modal-editar-data-form');
  var refEl  = document.getElementById('modal-editar-data-referrer');
  var inpEl  = document.getElementById('modal-editar-data-input');

  if (numEl)  numEl.textContent = shareNum;
  if (formEl) formEl.action     = '/cotas/' + shareId + '/retirada-data';
  if (refEl)  refEl.value       = window.location.href;
  if (inpEl)  inpEl.value       = effectiveDate;

  openModal('modal-editar-data-retirada');
};

/* ── Delete share modal ──────────────────────────────────── */
window.openDeleteModal = function (shareId, shareNum) {
  const numEl  = document.getElementById('modal-delete-share-num');
  const formEl = document.getElementById('form-excluir-cota');
  const refEl  = document.getElementById('modal-delete-referrer');
  if (numEl)  numEl.textContent = shareNum;
  if (formEl) formEl.action = '/cotas/' + shareId + '/excluir';
  if (refEl)  refEl.value = window.location.href;
  openModal('modal-excluir-cota');
};

/* ── Escape HTML (uso geral) ──────────────────────────────── */
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Vencimentos e Retiradas: seleção em lote ────────────── */
function getSelectedShareIds() {
  return Array.from(document.querySelectorAll('.row-select:checked'))
    .map(function (el) { return parseInt(el.dataset.shareId, 10); })
    .filter(function (n) { return !isNaN(n); });
}

function setupBulkSelection() {
  var selectAll = document.getElementById('select-all-cotas');
  var rowChecks = function () { return document.querySelectorAll('.row-select'); };
  if (!selectAll && rowChecks().length === 0) return;

  function updateToolbar() {
    var ids = getSelectedShareIds();
    var countEl = document.getElementById('bulk-selected-count');
    if (countEl) countEl.textContent = ids.length + ' cota(s) selecionada(s)';

    ['btn-renovar-lote', 'btn-retirada-lote', 'btn-email-lote',
     'btn-editar-lote'].forEach(function (btnId) {
      var btn = document.getElementById(btnId);
      if (btn) btn.disabled = ids.length === 0;
    });

    var all = rowChecks();
    if (selectAll && all.length) {
      var checkedCount = Array.from(all).filter(function (c) { return c.checked; }).length;
      selectAll.checked = checkedCount === all.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < all.length;
    }
  }

  if (selectAll) {
    selectAll.addEventListener('change', function () {
      rowChecks().forEach(function (c) { c.checked = selectAll.checked; });
      updateToolbar();
    });
  }

  document.addEventListener('change', function (e) {
    if (e.target.classList && e.target.classList.contains('row-select')) {
      updateToolbar();
    }
  });

  updateToolbar();
}

function populateHiddenShareIds(containerId, ids) {
  var container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  ids.forEach(function (id) {
    var inp = document.createElement('input');
    inp.type = 'hidden';
    inp.name = 'share_ids[]';
    inp.value = id;
    container.appendChild(inp);
  });
}

/* ── Vencimentos e Retiradas: modal Renovar em lote ──────── */
window.openRenovarLoteModal = function () {
  var ids = getSelectedShareIds();
  if (!ids.length) { alert('Selecione ao menos uma cota.'); return; }

  populateHiddenShareIds('lote-renovar-share-ids', ids);

  var countEl = document.getElementById('lote-renovar-count');
  if (countEl) countEl.textContent = ids.length;

  var hoje = window.HOJE_ISO || new Date().toISOString().slice(0, 10);
  var rdEl = document.getElementById('lote-renovar-renewal-date');
  var mdEl = document.getElementById('lote-renovar-maturity-date');
  var noteEl = document.getElementById('lote-renovar-notes');
  if (rdEl) rdEl.value = hoje;
  if (mdEl) {
    var d = new Date(hoje + 'T00:00:00');
    d.setFullYear(d.getFullYear() + 1);
    mdEl.value = d.toISOString().slice(0, 10);
  }
  if (noteEl) noteEl.value = '';

  openModal('modal-renovar-lote');
};

/* ── Vencimentos e Retiradas: modal Marcar retirada em lote ─ */
window.openRetiradaLoteModal = function () {
  var ids = getSelectedShareIds();
  if (!ids.length) { alert('Selecione ao menos uma cota.'); return; }

  populateHiddenShareIds('lote-retirada-share-ids', ids);

  var countEl = document.getElementById('lote-retirada-count');
  if (countEl) countEl.textContent = ids.length;

  /* Verifica se há produtos diferentes entre as cotas selecionadas */
  var checked = Array.from(document.querySelectorAll('.row-select:checked'));
  var condCodes = new Set(checked.map(function (c) { return c.dataset.condCode || ''; }));
  var warningEl = document.getElementById('lote-retirada-warning');
  if (warningEl) warningEl.style.display = condCodes.size > 1 ? 'block' : 'none';

  var hoje = window.HOJE_ISO || new Date().toISOString().slice(0, 10);
  var reqEl = document.getElementById('lote-retirada-request-date');
  var effEl = document.getElementById('lote-retirada-effective-date');
  var noteEl = document.getElementById('lote-retirada-notes');
  if (reqEl) reqEl.value = hoje;
  if (effEl) effEl.value = '';
  if (noteEl) noteEl.value = '';

  openModal('modal-retirada-lote');
};

/* ── Vencimentos e Retiradas: preview de e-mail de renovação ─
   Não envia nada — apenas monta o rascunho por cliente.       */
window.openEmailPreviewModal = function (shareIdsFromCard) {
  var ids = (shareIdsFromCard && shareIdsFromCard.length)
    ? shareIdsFromCard
    : getSelectedShareIds();

  if (!ids.length) { alert('Selecione ao menos uma cota.'); return; }

  var loadingEl = document.getElementById('email-preview-loading');
  var listEl    = document.getElementById('email-preview-list');
  if (loadingEl) { loadingEl.style.display = 'block'; loadingEl.textContent = 'Carregando…'; }
  if (listEl) listEl.innerHTML = '';

  openModal('modal-email-preview');

  fetch('/erp/api/vencimentos/preview-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ share_ids: ids }),
  })
    .then(function (r) { return r.json(); })
    .then(function (data) { renderEmailPreview(data.items || []); })
    .catch(function () {
      if (loadingEl) { loadingEl.textContent = 'Não foi possível carregar o preview.'; }
    });
};

window.lastEmailPreviewItems = [];

function renderEmailPreview(items) {
  var loadingEl = document.getElementById('email-preview-loading');
  var listEl    = document.getElementById('email-preview-list');
  if (loadingEl) loadingEl.style.display = 'none';
  if (!listEl) return;

  window.lastEmailPreviewItems = items;

  if (!items.length) {
    listEl.innerHTML = '<div class="text-dim" style="font-size:13px;">Nenhum cliente para comunicação.</div>';
    return;
  }

  listEl.innerHTML = items.map(function (item, i) {
    var statusBadge = item.status_email === 'pronto'
      ? '<span class="badge badge-active">✓ Pronto</span>'
      : '<span class="badge badge-inactive">✗ Sem e-mail</span>';
    var datas = (item.maturity_dates || []).join(', ') || '—';

    var draftBtn = (item.status_email === 'pronto')
      ? '<button type="button" class="btn btn-primary btn-sm" id="gmail-draft-btn-' + i + '" ' +
          'onclick="createGmailDraft(' + i + ')">' +
          '📝 Criar rascunho no Gmail' +
        '</button>'
      : '<button type="button" class="btn btn-secondary btn-sm" disabled ' +
          'title="Cliente sem e-mail cadastrado.">' +
          'Cliente sem e-mail' +
        '</button>';

    var sendBtn = (item.status_email === 'pronto')
      ? '<button type="button" class="btn btn-danger btn-sm" id="gmail-send-btn-' + i + '" ' +
          'onclick="sendGmailEmailNow(' + i + ')" ' +
          'title="Envia o e-mail imediatamente — não cria rascunho.">' +
          '📤 Enviar e-mail agora' +
        '</button>'
      : '';

    return '' +
      '<div class="email-preview-card">' +
        '<div class="email-preview-card-header">' +
          '<div>' +
            '<strong style="color:#F5F5F5;">' + escHtml(item.client_name) + '</strong> ' +
            statusBadge +
            '<div class="text-dim" style="font-size:12px;margin-top:2px;">' +
              escHtml(item.condominium_name) + ' · ' + item.total_shares + ' cota(s) · ' +
              escHtml(item.total_value_fmt) + ' · Vencimento(s): ' + escHtml(datas) +
            '</div>' +
            '<div class="text-dim" style="font-size:12px;">E-mail: ' + escHtml(item.email || '—') + '</div>' +
            '<div class="text-dim" style="font-size:12px;">Prazo de renovação: ' + escHtml(item.renewal_term) +
              ' · Setor: ' + escHtml(item.sector_name) + '</div>' +
          '</div>' +
          '<div class="email-preview-card-actions">' + draftBtn + ' ' + sendBtn + '</div>' +
        '</div>' +
        '<div class="email-preview-draft">' +
          '<strong>Assunto:</strong> ' + escHtml(item.email_subject) + '\n\n' +
          escHtml(item.email_body) +
        '</div>' +
        '<div class="gmail-draft-status" id="gmail-draft-status-' + i + '"></div>' +
        '<div class="gmail-draft-status" id="gmail-send-status-' + i + '"></div>' +
      '</div>';
  }).join('');
}

/* ── Cria rascunho no Gmail para 1 item do preview (não envia nada) ──── */
window.createGmailDraft = function (idx) {
  var item = (window.lastEmailPreviewItems || [])[idx];
  if (!item) return;

  var btnEl    = document.getElementById('gmail-draft-btn-' + idx);
  var statusEl = document.getElementById('gmail-draft-status-' + idx);

  if (btnEl) btnEl.disabled = true;
  if (statusEl) {
    statusEl.className = 'gmail-draft-status text-dim';
    statusEl.textContent = 'Criando rascunho...';
  }

  fetch('/erp/api/gmail/criar-rascunho-renovacao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to_email:          item.email,
      subject:           item.email_subject,
      body:              item.email_body,
      client_id:         item.client_id,
      condominium_code:  item.condominium_code,
      reference_year:    window.REF_ANO || null,
      reference_month:   window.REF_MES || null,
      share_ids:         item.share_ids,
    }),
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.success) {
        if (statusEl) {
          statusEl.className = 'gmail-draft-status status-success';
          statusEl.textContent = '✓ ' + (data.message || 'Rascunho criado no Gmail com sucesso.');
        }
        /* mantém o botão desabilitado — já existe um rascunho criado */
        if (btnEl) btnEl.textContent = '✓ Rascunho criado';
      } else {
        if (statusEl) {
          statusEl.className = 'gmail-draft-status status-error';
          statusEl.textContent = '✗ ' + (data.message || 'Não foi possível criar o rascunho no Gmail.');
        }
        if (btnEl) btnEl.disabled = false;
      }
    })
    .catch(function () {
      if (statusEl) {
        statusEl.className = 'gmail-draft-status status-error';
        statusEl.textContent = '✗ Não foi possível conectar ao servidor para criar o rascunho.';
      }
      if (btnEl) btnEl.disabled = false;
    });
};

/* ── Envia o e-mail de verdade (não cria rascunho) para 1 item do preview ──
   Ação irreversível: exige confirmação explícita do usuário antes de chamar
   a API. A opção padrão/segura continua sendo "Criar rascunho no Gmail". */
window.sendGmailEmailNow = function (idx) {
  var item = (window.lastEmailPreviewItems || [])[idx];
  if (!item) return;

  var confirmado = window.confirm(
    'Confirma o envio imediato deste e-mail para ' + item.email + '? ' +
    'Essa ação não criará rascunho; o e-mail será enviado agora.'
  );
  if (!confirmado) return;

  var btnEl    = document.getElementById('gmail-send-btn-' + idx);
  var statusEl = document.getElementById('gmail-send-status-' + idx);

  if (btnEl) btnEl.disabled = true;
  if (statusEl) {
    statusEl.className = 'gmail-draft-status text-dim';
    statusEl.textContent = 'Enviando e-mail...';
  }

  fetch('/erp/api/gmail/enviar-email-renovacao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to_email:          item.email,
      subject:           item.email_subject,
      body:              item.email_body,
      client_id:         item.client_id,
      condominium_code:  item.condominium_code,
      reference_year:    window.REF_ANO || null,
      reference_month:   window.REF_MES || null,
      share_ids:         item.share_ids,
    }),
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.success) {
        if (statusEl) {
          statusEl.className = 'gmail-draft-status status-success';
          statusEl.textContent = '✓ ' + (data.message || 'E-mail enviado com sucesso.');
        }
        /* mantém o botão desabilitado — o e-mail já foi enviado */
        if (btnEl) btnEl.textContent = '✓ E-mail enviado';
      } else {
        if (statusEl) {
          statusEl.className = 'gmail-draft-status status-error';
          statusEl.textContent = '✗ ' + (data.message || 'Não foi possível enviar o e-mail pelo Gmail.');
        }
        if (btnEl) btnEl.disabled = false;
      }
    })
    .catch(function () {
      if (statusEl) {
        statusEl.className = 'gmail-draft-status status-error';
        statusEl.textContent = '✗ Não foi possível conectar ao servidor para enviar o e-mail.';
      }
      if (btnEl) btnEl.disabled = false;
    });
};

/* Close modal on overlay click */
document.addEventListener('click', function (e) {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
  }
});

/* ── Filtro de cotas por condomínio ─────────────────────── */
function setupCondominioFilter() {
  var searchInput  = document.getElementById('cond-search');
  var filterBtns   = document.querySelectorAll('[data-filter-status]');
  var counterEl    = document.getElementById('cond-filter-counter');
  if (!searchInput && !filterBtns.length) return;

  var currentStatus = 'todos';

  function normalizeStr(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  }

  function applyFilter() {
    var q  = normalizeStr(searchInput ? searchInput.value : '');
    var rows = document.querySelectorAll('tr[data-share-number]');
    var visible = 0, total = rows.length;

    rows.forEach(function (tr) {
      var statusMatch = (currentStatus === 'todos') || (tr.dataset.status === currentStatus);
      var textMatch = true;
      if (q) {
        var fields = [
          tr.dataset.shareNumber,
          tr.dataset.clientName,
          tr.dataset.clientDocument,
          tr.dataset.pix
        ].map(normalizeStr).join(' ');
        textMatch = fields.includes(q);
      }
      var show = statusMatch && textMatch;
      tr.style.display = show ? '' : 'none';
      if (show) visible++;
    });

    /* Atualiza contador */
    if (counterEl) {
      counterEl.textContent = visible === total
        ? 'Exibindo todas as ' + total + ' cotas'
        : 'Exibindo ' + visible + ' de ' + total + ' cotas';
      counterEl.style.color = visible === total ? '#555' : '#d4af37';
    }

    /* Esconde seção se todas as linhas ocultas */
    document.querySelectorAll('.cond-section-wrap').forEach(function (section) {
      var sectionRows = section.querySelectorAll('tr[data-share-number]');
      var anyVisible  = Array.from(sectionRows).some(function (r) { return r.style.display !== 'none'; });
      section.style.display = anyVisible ? '' : 'none';
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', applyFilter);
  }

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filterBtns.forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
      currentStatus = this.dataset.filterStatus;
      applyFilter();
    });
  });

  applyFilter();
}

/* ── Condomínio: seleção múltipla + edição em lote ───────── */
function setupCondominioBulkEdit() {
  var toolbar = document.getElementById('cond-bulk-toolbar');
  if (!toolbar) return;

  /* Linhas visíveis (respeita o filtro de busca/status da tela) */
  function visibleRowChecks() {
    return Array.from(document.querySelectorAll('.row-select')).filter(function (c) {
      var tr = c.closest('tr');
      return tr && tr.style.display !== 'none';
    });
  }

  function setChecked(checks, value) {
    checks.forEach(function (c) {
      if (c.checked !== value) {
        c.checked = value;
        c.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  /* "Selecionar todas as cotas exibidas" */
  var selectAllVisiveis = document.getElementById('cond-select-all-visiveis');
  if (selectAllVisiveis) {
    selectAllVisiveis.addEventListener('change', function () {
      setChecked(visibleRowChecks(), selectAllVisiveis.checked);
    });
  }

  /* Select-all do cabeçalho de cada tabela (ativas / pendentes / inativas) */
  document.querySelectorAll('.cond-select-all-table').forEach(function (master) {
    master.addEventListener('change', function () {
      var table = master.closest('table');
      if (!table) return;
      var checks = Array.from(table.querySelectorAll('.row-select')).filter(function (c) {
        var tr = c.closest('tr');
        return tr && tr.style.display !== 'none';
      });
      setChecked(checks, master.checked);
    });
  });

  /* Limpar seleção */
  var btnLimpar = document.getElementById('btn-limpar-selecao');
  if (btnLimpar) {
    btnLimpar.addEventListener('click', function () {
      setChecked(Array.from(document.querySelectorAll('.row-select')), false);
      if (selectAllVisiveis) selectAllVisiveis.checked = false;
      document.querySelectorAll('.cond-select-all-table').forEach(function (m) {
        m.checked = false;
        m.indeterminate = false;
      });
    });
  }

  /* Mantém os masters coerentes com o que está marcado */
  document.addEventListener('change', function (e) {
    if (!(e.target.classList && e.target.classList.contains('row-select'))) return;
    document.querySelectorAll('.cond-select-all-table').forEach(function (master) {
      var table = master.closest('table');
      if (!table) return;
      var all = Array.from(table.querySelectorAll('.row-select'));
      var marcados = all.filter(function (c) { return c.checked; }).length;
      master.checked = all.length > 0 && marcados === all.length;
      master.indeterminate = marcados > 0 && marcados < all.length;
    });
  });

  /* Abrir o grid de edição em lote com as cotas selecionadas */
  var btnEditar = document.getElementById('btn-editar-lote');
  if (btnEditar) {
    btnEditar.addEventListener('click', function () {
      var ids = getSelectedShareIds();
      if (!ids.length) { alert('Selecione ao menos uma cota.'); return; }
      populateHiddenShareIds('cond-lote-share-ids', ids);
      var form = document.getElementById('form-cond-editar-lote');
      if (form) form.submit();
    });
  }
}

/* ── Sidebar groups (expansível) ─────────────────────────── */
function setupSidebarGroups() {
  document.querySelectorAll('.sidebar-group-btn').forEach(function (btn) {
    var targetId = btn.dataset.target;
    var items    = document.getElementById(targetId);
    if (!items) return;

    /* Restaurar estado salvo apenas se o grupo não estiver aberto pelo servidor
       (o servidor já marca com .open quando a página ativa pertence ao grupo) */
    if (!items.classList.contains('open')) {
      try {
        if (sessionStorage.getItem('sg-' + targetId) === '1') {
          items.classList.add('open');
          btn.classList.add('group-open');
        }
      } catch (e) {}
    }

    btn.addEventListener('click', function () {
      var isOpen = items.classList.contains('open');
      items.classList.toggle('open', !isOpen);
      btn.classList.toggle('group-open', !isOpen);
      try {
        sessionStorage.setItem('sg-' + targetId, isOpen ? '' : '1');
      } catch (e) {}
    });
  });
}

/* ── Init ────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-mask="cpf"]').forEach(maskCPF);
  document.querySelectorAll('[data-mask="cpfcnpj"]').forEach(maskCpfCnpj);
  document.querySelectorAll('[data-mask="phone"]').forEach(maskPhone);
  document.querySelectorAll('[data-mask="currency"]').forEach(function (el) {
    maskCurrency(el);
    /* Formata valor inicial (ex: "10000.00" → "10.000,00") */
    var n = parseFloat(el.value);
    if (!isNaN(n) && n > 0 && !/[,.]/.test(el.value.replace(/\d/g, '').replace('.','').substring(0,1))) {
      el.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    }
  });
  setupSidebarGroups();
  setupShareNumberSuggestion();
  setupMultiShareForm();
  setupCondominioFilter();
  setupAlertDismiss();
  setupConfirmForms();
  setupBulkSelection();
  setupCondominioBulkEdit();
});
