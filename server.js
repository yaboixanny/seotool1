import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { parseString } from 'xml2js';
import { promisify } from 'util';

const parseXml = promisify(parseString);
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Helper to find sitemap from robots.txt or common paths
const discoverSitemap = async (baseUrl) => {
    const commonPaths = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'];

    try {
        const robotsRes = await axios.get(`${baseUrl}/robots.txt`, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        }).catch(() => null);

        if (robotsRes && robotsRes.data) {
            const match = robotsRes.data.match(/Sitemap:\s*(https?:\/\/\S+)/i);
            if (match) return match[1];
        }

        for (const path of commonPaths) {
            try {
                // Using GET instead of HEAD as some servers block HEAD
                const res = await axios.get(`${baseUrl}${path}`, {
                    timeout: 3000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
                });
                if (res.status === 200) return `${baseUrl}${path}`;
            } catch (e) { }
        }
    } catch (e) { }

    return null;
};

// Helper to fetch and parse sitemap
const fetchSitemap = async (url) => {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
        });

        if (!response.data || typeof response.data !== 'string') {
            throw new Error('Sitemap response is empty or not text');
        }

        // Sanitize XML: replace unescaped & with &amp;
        const sanitizedData = response.data.replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;');
        const parsed = await parseXml(sanitizedData);
        return parsed;
    } catch (error) {
        console.error(`Error fetching ${url}:`, error.message);
        throw error;
    }
};

app.post('/api/discover-sitemaps', async (req, res) => {
    let { baseUrl } = req.body;
    if (!baseUrl) return res.status(400).json({ error: 'Base URL is required' });

    baseUrl = baseUrl.replace(/\/$/, '');
    if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;

    const sitemaps = new Set();
    const commonPaths = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap_pages.xml', '/sitemap_posts.xml'];

    try {
        // 1. Check robots.txt
        const robotsRes = await axios.get(`${baseUrl}/robots.txt`, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        }).catch(() => null);

        if (robotsRes && robotsRes.data && typeof robotsRes.data === 'string') {
            const matches = robotsRes.data.matchAll(/Sitemap:\s*(https?:\/\/\S+)/gi);
            for (const match of matches) {
                sitemaps.add(match[1]);
            }
        }

        // 2. Check common paths (in parallel)
        await Promise.all(commonPaths.map(async (path) => {
            try {
                const url = `${baseUrl}${path}`;
                const res = await axios.get(url, {
                    timeout: 4000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
                    maxContentLength: 10000
                });
                if (res.status === 200 && typeof res.data === 'string' && res.data.includes('<sitemap')) {
                    sitemaps.add(url);
                }
            } catch (e) { }
        }));

        res.json({ sitemaps: Array.from(sitemaps) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/analyze-sitemap', async (req, res) => {
    let { sitemapUrl } = req.body;

    if (!sitemapUrl) {
        return res.status(400).json({ error: 'Sitemap URL is required' });
    }

    // Basic discovery if it looks like a homepage
    if (!sitemapUrl.endsWith('.xml')) {
        const discovered = await discoverSitemap(sitemapUrl.replace(/\/$/, ''));
        if (discovered) {
            sitemapUrl = discovered;
        } else {
            // If not .xml and not discovered, try appending sitemap.xml as a last resort
            sitemapUrl = sitemapUrl.replace(/\/$/, '') + '/sitemap.xml';
        }
    }

    try {
        const sitemapData = await fetchSitemap(sitemapUrl);

        let urls = [];

        // Helper to normalize loc
        const getLoc = (item) => (Array.isArray(item.loc) ? item.loc[0] : item.loc);

        // Handle sitemap index
        if (sitemapData.sitemapindex) {
            const index = sitemapData.sitemapindex;
            const entries = Array.isArray(index.sitemap) ? index.sitemap : [index.sitemap];
            const nestedSitemaps = entries.map(getLoc).filter(l => l);

            const results = await Promise.all(nestedSitemaps.slice(0, 15).map(fetchSitemap).map(p => p.catch(e => null)));
            results.forEach(res => {
                if (res && res.urlset && res.urlset.url) {
                    const urlEntries = Array.isArray(res.urlset.url) ? res.urlset.url : [res.urlset.url];
                    urls = urls.concat(urlEntries.map(getLoc).filter(l => l));
                }
            });
        } else if (sitemapData.urlset && sitemapData.urlset.url) {
            const urlEntries = Array.isArray(sitemapData.urlset.url) ? sitemapData.urlset.url : [sitemapData.urlset.url];
            urls = urls.concat(urlEntries.map(getLoc).filter(l => l));
        }

        if (urls.length === 0) {
            return res.status(404).json({ error: 'No URLs successfully extracted. The site might be blocking us or the format is unusual.' });
        }

        // De-duplicate URLs
        urls = [...new Set(urls)];

        res.json({ urls });
    } catch (error) {
        console.error('Analysis Error:', error);
        res.status(500).json({ error: 'Failure: ' + (error.response?.statusText || error.message) });
    }
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'));
}

// Global Error Handler to ensure we always return JSON
app.use((err, req, res, next) => {
    console.error('Global Error Handler:', err);
    res.status(500).json({
        error: 'Critical Server Error',
        details: err.message
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
