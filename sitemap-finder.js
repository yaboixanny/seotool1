const domainInput = document.getElementById('domain-url');
const findBtn = document.getElementById('find-btn');
const loadingSection = document.getElementById('loading');
const resultsSection = document.getElementById('results');
const sitemapListElem = document.getElementById('sitemap-list');

findBtn.addEventListener('click', findSitemaps);

async function findSitemaps() {
    const url = domainInput.value.trim();
    if (!url) {
        alert('Please enter a valid domain or URL');
        return;
    }

    loadingSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    sitemapListElem.innerHTML = '';

    try {
        const response = await fetch('/api/discover-sitemaps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseUrl: url })
        });

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error('Server returned an invalid response.');
        }

        if (!response.ok) {
            throw new Error(data.error || 'Failed to discover sitemaps');
        }

        renderSitemaps(data.sitemaps);
        loadingSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');
    } catch (error) {
        alert('Error: ' + error.message);
        loadingSection.classList.add('hidden');
    }
}

function renderSitemaps(sitemaps) {
    if (sitemaps.length === 0) {
        sitemapListElem.innerHTML = '<p style="color: var(--text-secondary);">No sitemaps found in common locations or robots.txt.</p>';
        return;
    }

    sitemaps.forEach(url => {
        const card = document.createElement('div');
        card.className = 'theme-card';
        card.style.cursor = 'default';

        const title = document.createElement('div');
        title.className = 'theme-title';
        title.style.fontSize = '0.9rem';
        title.style.wordBreak = 'break-all';
        title.innerText = url;

        const actions = document.createElement('div');
        actions.style.marginTop = '1rem';
        actions.style.display = 'flex';
        actions.style.gap = '0.5rem';

        const openBtn = document.createElement('button');
        openBtn.className = 'export-btn';
        openBtn.innerText = 'Open XML';
        openBtn.style.padding = '0.4rem 0.8rem';
        openBtn.style.fontSize = '0.8rem';
        openBtn.onclick = () => window.open(url, '_blank');

        const analyzeBtn = document.createElement('button');
        analyzeBtn.className = 'export-btn';
        analyzeBtn.innerText = 'Analyze this Sitemap';
        analyzeBtn.style.padding = '0.4rem 0.8rem';
        analyzeBtn.style.fontSize = '0.8rem';
        analyzeBtn.style.background = 'var(--accent-color)';
        analyzeBtn.style.color = 'white';
        analyzeBtn.onclick = () => {
            window.location.href = `sitemap-architect.html?url=${encodeURIComponent(url)}`;
        };

        actions.appendChild(openBtn);
        actions.appendChild(analyzeBtn);
        card.appendChild(title);
        card.appendChild(actions);
        sitemapListElem.appendChild(card);
    });
}
