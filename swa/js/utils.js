// Shared utilities — DOM helpers, API wrapper, formatting

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return document.querySelectorAll(selector);
}

function setContent(element, content) {
  if (typeof element === 'string') element = $(element);
  element.textContent = '';
  if (typeof content === 'string') {
    element.insertAdjacentHTML('beforeend', content);
  } else if (content instanceof Node) {
    element.appendChild(content);
  }
}

function show(element) {
  if (typeof element === 'string') element = $(element);
  element.style.display = '';
}

function hide(element) {
  if (typeof element === 'string') element = $(element);
  element.style.display = 'none';
}

async function azureFetch(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Azure API error ${response.status}: ${text}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function formatDate(dateStr) {
  if (!dateStr) return '\u2014';
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function showModal(title, bodyHtml, actionsHtml) {
  const container = document.getElementById('modal-container');
  container.textContent = '';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', closeModal);

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.addEventListener('click', e => e.stopPropagation());

  const h3 = document.createElement('h3');
  h3.textContent = title;
  modal.appendChild(h3);

  const body = document.createElement('div');
  body.insertAdjacentHTML('beforeend', bodyHtml);
  modal.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  actions.insertAdjacentHTML('beforeend', actionsHtml);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  container.appendChild(overlay);
}

function closeModal() {
  document.getElementById('modal-container').textContent = '';
}

function showToast(message, type) {
  type = type || 'info';
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 4000);
}
