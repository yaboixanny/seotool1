const sitemapInput = document.getElementById('sitemap-url');
const analyzeBtn = document.getElementById('analyze-btn');
const loadingSection = document.getElementById('loading');
const resultsSection = document.getElementById('results');
const urlCountElem = document.getElementById('url-count');
const depthCountElem = document.getElementById('depth-count');
const themesCountElem = document.getElementById('themes-count');
const sitemapTreeElem = document.getElementById('sitemap-tree');
const themesListElem = document.getElementById('themes-list');
const tabs = document.querySelectorAll('.tabs button');
const tabContents = document.querySelectorAll('.tab-content');

analyzeBtn.addEventListener('click', analyzeSitemap);

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(`${tab.dataset.tab}-view`).classList.add('active');
    });
});

async function analyzeSitemap() {
    const url = sitemapInput.value.trim();
    if (!url) {
        alert('Please enter a valid sitemap URL');
        return;
    }

    // Reset UI
    loadingSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');

    try {
        const response = await fetch('http://localhost:3001/api/analyze-sitemap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sitemapUrl: url })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Failed to analyze sitemap');
        }

        const { urls } = await response.json();

        processUrls(urls);

        loadingSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');
    } catch (error) {
        alert('Error: ' + error.message);
        loadingSection.classList.add('hidden');
    }
}

function processUrls(urls) {
    window.currentUrls = urls; // Store for export
    urlCountElem.innerText = urls.length;

    const tree = buildTree(urls);
    renderTree(tree, sitemapTreeElem);

    const themes = extractThemes(urls);
    renderThemes(themes);

    depthCountElem.innerText = getMaxDepth(tree);
    themesCountElem.innerText = themes.length;
}

function buildTree(urls) {
    const root = {};

    urls.forEach(url => {
        try {
            const parsed = new URL(url);
            const pathParts = parsed.pathname.split('/').filter(p => p);

            let current = root;
            pathParts.forEach(part => {
                if (!current[part]) {
                    current[part] = { _children: {} };
                }
                current = current[part]._children;
            });
        } catch (e) {
            console.error('Invalid URL:', url);
        }
    });

    return root;
}

function renderTree(node, container) {
    container.innerHTML = '';

    Object.keys(node).forEach(key => {
        const div = document.createElement('div');
        div.className = 'tree-node';

        const content = document.createElement('div');
        content.className = 'node-content';

        const icon = document.createElement('span');
        icon.className = 'node-icon';
        icon.innerText = Object.keys(node[key]._children).length > 0 ? '📁' : '📄';

        const label = document.createElement('span');
        label.className = 'node-label';
        label.innerText = key;

        content.appendChild(icon);
        content.appendChild(label);

        if (Object.keys(node[key]._children).length > 0) {
            const count = document.createElement('span');
            count.className = 'node-count';
            count.innerText = Object.keys(node[key]._children).length;
            content.appendChild(count);
        }

        div.appendChild(content);

        if (Object.keys(node[key]._children).length > 0) {
            const childrenContainer = document.createElement('div');
            renderTree(node[key]._children, childrenContainer);
            div.appendChild(childrenContainer);
        }

        container.appendChild(div);
    });
}

function extractThemes(urls) {
    const themes = {};
    const stopWords = new Set(['a', 'the', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'an', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'to', 'with']);

    urls.forEach(url => {
        try {
            const pathParts = new URL(url).pathname.split('/').filter(p => p && p.length > 2);
            pathParts.forEach((part, index) => {
                // Give more weight to higher level parts
                const weight = Math.max(1, 4 - index);
                const words = part.split(/[-_]/).filter(w => !stopWords.has(w.toLowerCase()) && isNaN(w));

                words.forEach(word => {
                    const normalized = word.toLowerCase();
                    themes[normalized] = (themes[normalized] || 0) + weight;
                });
            });
        } catch (e) { }
    });

    return Object.entries(themes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([name, count]) => ({ name, count: Math.round(count) }));
}

function renderThemes(themes) {
    themesListElem.innerHTML = '';

    const headerActions = document.createElement('div');
    headerActions.style.marginBottom = '20px';
    headerActions.style.display = 'flex';
    headerActions.style.justifyContent = 'flex-end';

    const exportBtn = document.createElement('button');
    exportBtn.className = 'export-btn';
    exportBtn.innerText = 'Download Structure Report (CSV)';
    exportBtn.onclick = () => downloadCSV();
    headerActions.appendChild(exportBtn);
    themesListElem.appendChild(headerActions);

    const grid = document.createElement('div');
    grid.className = 'themes-grid';

    themes.forEach(theme => {
        const card = document.createElement('div');
        card.className = 'theme-card';

        const title = document.createElement('div');
        title.className = 'theme-title';
        title.innerText = theme.name;

        const count = document.createElement('div');
        count.className = 'theme-count';
        count.innerText = `Relevance Score: ${theme.count}`;

        card.appendChild(title);
        card.appendChild(count);
        grid.appendChild(card);
    });

    themesListElem.appendChild(grid);
}

function downloadCSV() {
    const rows = [['URL']];
    // We don't have the original URL list stored globally yet, let's fix that in processUrls
    const urls = window.currentUrls || [];
    urls.forEach(url => rows.push([url]));

    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "sitemap_analysis.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function getMaxDepth(node) {
    let max = 0;
    Object.values(node).forEach(n => {
        max = Math.max(max, 1 + getMaxDepth(n._children));
    });
    return max;
}
