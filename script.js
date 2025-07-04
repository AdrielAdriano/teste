async function makeRequest(url, method = 'GET', headers = {}, body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Erro HTTP: ${res.status}`);
  return res.json();
}

function getTokenLeia(ra, senha) {
  return makeRequest('https://api.moonscripts.cloud/livros', 'POST', {}, {
    type: 'getToken',
    ra,
    senha
  });
}

window.startMoonLeia = async function () {
  'use strict';

  let isRunning = false;
  let intervalTime = 1000;
  let currentPageIndex = 0;
  let pages = [];
  let currentBookSlug = null;
  let booksCache = [];
  let token = null;

  const booksContainer = document.getElementById("books-container");
  const readerDiv = document.getElementById("reader");
  const pagesSelect = document.getElementById("pages");
  const contentDiv = document.getElementById("conteudo");
  const timeInput = document.getElementById("timeInput");
  const autoButton = document.getElementById("autoButton");

  const user = window.userLogin || {};
  const ra = user.ra;
  const senha = user.senha;

  if (!ra || !senha) {
    showNotification("❌ RA ou senha ausentes.");
    return false;
  }

  try {
    const data = await getTokenLeia(ra, senha);
    token = data?.result?.token;
    if (!token) {
      showNotification("❌ RA ou senha incorretos.");
      return false;
    }
    await loadBooks();
    return true;
  } catch (err) {
    showNotification("❌ Erro ao autenticar.");
    console.error(err);
    return false;
  }

  async function apiRequest(type, extra = {}) {
    return await makeRequest("https://api.moonscripts.cloud/livros", "POST", {}, { type, token, ...extra });
  }

  function showNotification(msg) {
    const n = document.createElement("div");
    n.textContent = msg;
    Object.assign(n.style, {
      position: "fixed",
      bottom: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#9333ea",
      color: "#fff",
      padding: "10px 20px",
      borderRadius: "10px",
      boxShadow: "0 0 10px #a855f7aa",
      zIndex: 9999
    });
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 5000);
  }

  async function loadBooks() {
    showNotification("Carregando livros...");
    try {
      const data = await apiRequest("buscarLivros");
      const books = data?.result?.data?.searchBookV3?.books || [];
      booksContainer.innerHTML = "";
      booksCache = books;

      if (!books.length) {
        booksContainer.innerHTML = "<p>Nenhum livro encontrado.</p>";
        showNotification("⚠️ Nenhum livro encontrado.");
        return;
      }

      for (const book of books) {
        const card = document.createElement("div");
        card.className = "book-card";
        card.innerHTML = `
          <div class="book-image-container">
            <img src="${book.imageUrlThumb || 'https://via.placeholder.com/150'}" alt="Livro">
          </div>
          <div class="book-title">${book.name || 'Título desconhecido'}</div>
          <p style="color:#bbb;font-size:0.9rem">${book.author || "Autor desconhecido"}</p>
        `;

        const btn = document.createElement("button");
        btn.className = "concluir-btn";
        btn.textContent = "📖 Ler com Cheat";
        btn.onclick = () => {
          currentBookSlug = book.slug;
          loadRealPages(book.slug);
        };

        const verDetalhesBtn = document.createElement("button");
        verDetalhesBtn.className = "ver-detalhes-btn";
        verDetalhesBtn.textContent = "📄 Ver detalhes";
        verDetalhesBtn.onclick = () => mostrarDetalhesLivro(book.slug);

        card.appendChild(btn);
        card.appendChild(verDetalhesBtn);
        booksContainer.appendChild(card);
      }
      showNotification("✅ Livros carregados.");
    } catch (err) {
      showNotification("❌ Erro ao carregar livros.");
      console.error(err);
    }
  }

  async function loadRealPages(slug) {
    booksContainer.classList.add("hidden");
    readerDiv.classList.remove("hidden");
    try {
      const chaptersRes = await apiRequest("capitulosLivro", { book_id: slug });
      const chapters = chaptersRes?.result?.data || [];
      pages = [];
      const pagePromises = chapters.map(async (chapter) => {
        const pagesRes = await apiRequest("paginasCapitulo", { chapterId: chapter.id });
        const pagesData = pagesRes?.result?.data || [];
        return pagesData.map(page => ({
          chapterId: chapter.id,
          title: page.title || "Página",
          content: page.htmlContent || page.text || "<p>[Sem conteúdo]</p>"
        }));
      });
      pages = (await Promise.all(pagePromises)).flat();
      if (!pages.length) {
        showNotification("❌ Nenhuma página encontrada.");
        readerDiv.classList.add("hidden");
        booksContainer.classList.remove("hidden");
        return;
      }

      pagesSelect.innerHTML = "";
      pages.forEach((page, i) => {
        const option = document.createElement("option");
        option.value = i;
        option.textContent = page.title;
        pagesSelect.appendChild(option);
      });

      pagesSelect.onchange = () => openPage(parseInt(pagesSelect.value));
      timeInput.oninput = () => intervalTime = parseInt(timeInput.value) || 1000;
      autoButton.onclick = () => isRunning ? pauseAuto() : startAuto();

      openPage(0);
      startAuto();
    } catch (err) {
      showNotification("❌ Erro ao carregar páginas do livro.");
      console.error(err);
      readerDiv.classList.add("hidden");
      booksContainer.classList.remove("hidden");
    }
  }

  function openPage(index) {
    if (index < 0 || index >= pages.length) return;
    currentPageIndex = index;
    pagesSelect.value = index;
    contentDiv.innerHTML = pages[index].content || "<p>[Sem conteúdo]</p>";
    contentDiv.scrollTop = 0;
    showNotification(`📖 Página ${index + 1} de ${pages.length}`);
  }

  function pauseAuto() {
    isRunning = false;
    autoButton.textContent = "🚀 Autocompletar Tudo";
  }

  async function startAuto() {
    if (isRunning) return;
    isRunning = true;
    autoButton.textContent = "⏸️ Pausar Autocompletar";
    const scroll = async () => {
      if (!isRunning) return;
      if (contentDiv.scrollTop + contentDiv.clientHeight >= contentDiv.scrollHeight - 10) {
        if (currentPageIndex + 1 < pages.length) {
          openPage(++currentPageIndex);
          await apiRequest("registrarPagina", {
            book_slug: currentBookSlug,
            chapter_id: pages[currentPageIndex].chapterId,
            page_number: currentPageIndex + 1
          });
          if (currentPageIndex % 10 === 0) await apiRequest("marcarCapituloLido", { book_id: currentBookSlug, chapter_id: pages[currentPageIndex].chapterId });
          if (currentPageIndex % 5 === 0) await apiRequest("highlight", { chapter_id: pages[currentPageIndex].chapterId, content: "Trecho destacado automaticamente", color: "#FFFF00" });
          if (currentPageIndex % 15 === 0) await apiRequest("bookmark", { chapter_id: pages[currentPageIndex].chapterId, page_number: currentPageIndex + 1 });
          setTimeout(scroll, intervalTime);
        } else {
          showNotification("✅ Leitura concluída.");
          pauseAuto();
        }
      } else {
        contentDiv.scrollBy(0, 10);
        requestAnimationFrame(scroll);
      }
    };
    scroll();
  }
};

async function mostrarDetalhesLivro(slug) {
  try {
    criarModalDetalhes();
    const detalhes = await makeRequest("https://api.moonscripts.cloud/livros", "POST", {}, { type: "detalhesLivro", slug });
    const info = detalhes?.result?.data;
    if (!info) {
      document.getElementById("conteudoDetalhesLivro").innerHTML = "<p>❌ Não foi possível carregar os detalhes do livro.</p>";
      return;
    }
    const { name, author, description, year, estimatedReadingTimeInMinutes, readPercentage, isFinished, chapterCount } = info;
    document.getElementById("conteudoDetalhesLivro").innerHTML = `
      <h2 style="margin-top: 0;">📘 ${name}</h2>
      <p><strong>✍️ Autor:</strong> ${author || 'Desconhecido'}</p>
      <p><strong>📅 Ano:</strong> ${year || 'N/A'}</p>
      <p><strong>📖 Capítulos:</strong> ${chapterCount || 'N/A'}</p>
      <p><strong>⏱️ Tempo estimado:</strong> ${estimatedReadingTimeInMinutes || 'N/A'} min</p>
      <p><strong>📈 Progresso:</strong> ${readPercentage != null ? readPercentage + '%' : 'N/A'}</p>
      <p><strong>✅ Lido:</strong> ${isFinished ? 'Sim' : 'Não'}</p>
      <p style="margin-top: 15px;"><strong>📄 Sinopse:</strong></p>
      <p style="font-size: 0.95rem;">${description || 'Nenhuma descrição disponível.'}</p>
    `;
  } catch (err) {
    console.error("Erro ao buscar detalhes do livro:", err);
    alert("❌ Erro ao buscar detalhes do livro.");
  }
}

function criarModalDetalhes() {
  const modal = document.createElement("div");
  modal.id = "modalDetalhesLivro";
  modal.style = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
    box-sizing: border-box;
  `;
  modal.innerHTML = `
    <div style="background: #fff; color: #111; padding: 20px; border-radius: 10px; max-width: 500px; width: 100%; position: relative;">
      <button id="fecharModalDetalhes" style="position: absolute; top: 10px; right: 15px; background: #9333ea; color: #fff; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer;">Fechar</button>
      <div id="conteudoDetalhesLivro">
        <p>Carregando detalhes...</p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById("fecharModalDetalhes").onclick = () => modal.remove();
}
