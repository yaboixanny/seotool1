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
        const robotsRes = await axios.get(`${baseUrl}/robots.txt`, { timeout: 5000 }).catch(() => null);
        if (robotsRes && robotsRes.data) {
            const match = robotsRes.data.match(/Sitemap:\s*(https?:\/\/\S+)/i);
            if (match) return match[1];
        }

        for (const path of commonPaths) {
            try {
                // Using GET instead of HEAD as some servers block HEAD
                const res = await axios.get(`${baseUrl}${path}`, { timeout: 3000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } });
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
            headers: { 'User-Agent': 'Mozilla/5.0' }
        }).catch(() => null);

        if (robotsRes && robotsRes.data) {
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
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    maxContentLength: 1000 // Just need the start
                });
                if (res.status === 200 && res.data.includes('<sitemap')) {
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
            const nestedSitemaps = entries.map(getLoc);

            const results = await Promise.all(nestedSitemaps.slice(0, 10).map(fetchSitemap).map(p => p.catch(e => null)));
            results.forEach(res => {
                if (res && res.urlset && res.urlset.url) {
                    const urlEntries = Array.isArray(res.urlset.url) ? res.urlset.url : [res.urlset.url];
                    urls = urls.concat(urlEntries.map(getLoc));
                }
            });
        } else if (sitemapData.urlset && sitemapData.urlset.url) {
            const urlEntries = Array.isArray(sitemapData.urlset.url) ? sitemapData.urlset.url : [sitemapData.urlset.url];
            urls = urls.concat(urlEntries.map(getLoc));
        }

        if (urls.length === 0) {
            return res.status(404).json({ error: 'No URLs successfully extracted from sitemap. The site might be blocking our automated requests.' });
        }

        res.json({ urls });
    } catch (error) {
        console.error('Analysis Error:', error);
        res.status(500).json({ error: 'Failed to analyze sitemap: ' + (error.response?.statusText || error.message) });
    }
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'));
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
