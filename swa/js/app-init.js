// App initialization — wires up tab switching and sign-in buttons
// Loaded after all other scripts

// Tab switcher
document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    // Stop auto-refresh when leaving the Activity tab
    if (window.stopAutoRefresh) window.stopAutoRefresh();
    var loadFn = window['load' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1) + 'Tab'];
    if (loadFn) loadFn();
  });
});

// Sign-in buttons
document.querySelectorAll('[data-action="sign-in"]').forEach(function(btn) {
  btn.addEventListener('click', function() { signIn(); });
});
