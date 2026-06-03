const tabButtons = document.querySelectorAll('[data-tab]');
const forms = document.querySelectorAll('[data-form]');
const message = document.querySelector('[data-message]');

if (localStorage.getItem('authToken')) {
  window.location.href = '/game.html';
}

for (const button of tabButtons) {
  button.addEventListener('click', () => {
    const selectedTab = button.dataset.tab;

    for (const tabButton of tabButtons) {
      tabButton.classList.toggle('active', tabButton.dataset.tab === selectedTab);
    }

    for (const form of forms) {
      form.classList.toggle('active', form.dataset.form === selectedTab);
    }

    message.textContent = '';
  });
}

for (const form of forms) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const mode = form.dataset.form;
    const formData = new FormData(form);
    const payload = {
      username: formData.get('username'),
      password: formData.get('password'),
    };

    setLoading(form, true);
    message.textContent = '';

    try {
      const response = await fetch(`/api/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        message.textContent = data.error || 'Nao foi possivel completar a acao.';
        return;
      }

      localStorage.setItem('authToken', data.token);
      localStorage.setItem('username', data.user.username);
      window.location.href = '/game.html';
    } catch {
      message.textContent = 'Servidor indisponivel. Verifique o Node e o MySQL.';
    } finally {
      setLoading(form, false);
    }
  });
}

function setLoading(form, isLoading) {
  const button = form.querySelector('button[type="submit"]');

  button.disabled = isLoading;
  button.textContent = isLoading ? 'Aguarde...' : form.dataset.form === 'login' ? 'Entrar no jogo' : 'Criar conta';
}
