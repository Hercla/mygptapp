const button = document.getElementById('ping');
const output = document.getElementById('output');

button.addEventListener('click', () => {
  output.textContent = 'OK: app.js est bien connecté.';
});