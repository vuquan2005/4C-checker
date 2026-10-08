import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchThreadPage, extractTotalPages, fetchAllThreadPages } from './mybb-client.js';

describe('MyBB Network Client', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('extractTotalPages', () => {
        it('returns 1 when pagination is absent', () => {
            const html = '<div>No pagination here</div>';
            expect(extractTotalPages(html)).toBe(1);
        });

        it('extracts total pages from .pagination_last link', () => {
            const html = `
<div class="pagination">
  <span class="pages">Trang (1 / 4)</span>
  <span class="pagination_current">1</span>
  <a href="showthread.php?tid=1336&amp;page=2" class="pagination_page">2</a>
  <a href="showthread.php?tid=1336&amp;page=4" class="pagination_last">4</a>
</div>
            `;
            expect(extractTotalPages(html)).toBe(4);
        });

        it('extracts total pages from max .pagination_page number', () => {
            const html = `
<div class="pagination">
  <span class="pagination_current">1</span>
  <a href="showthread.php?tid=1336&amp;page=2" class="pagination_page">2</a>
  <a href="showthread.php?tid=1336&amp;page=3" class="pagination_page">3</a>
</div>
            `;
            expect(extractTotalPages(html)).toBe(3);
        });
    });

    describe('fetchThreadPage', () => {
        it('fetches single page with proper headers and cookie', async () => {
            const mockHtml = '<html><body>Mock thread content</body></html>';
            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(mockHtml, {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' },
                })
            );

            const result = await fetchThreadPage(1336, 1, {
                cookie: 'mybbuser=123; sid=456',
            });

            expect(result).toBe(mockHtml);
            expect(fetchSpy).toHaveBeenCalledTimes(1);

            const callArgs = fetchSpy.mock.calls[0];
            expect(callArgs[0]).toBe('https://kisu4chaui.com/showthread.php?tid=1336&page=1');
            const headers = callArgs[1]?.headers as Record<string, string>;
            expect(headers['Cookie']).toBe('mybbuser=123; sid=456');
        });

        it('throws an error on HTTP failure status', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response('Forbidden', {
                    status: 403,
                    statusText: 'Forbidden',
                })
            );

            await expect(fetchThreadPage(1336, 1)).rejects.toThrowError(
                /Failed to fetch thread 1336 page 1: HTTP 403/
            );
        });
    });

    describe('fetchAllThreadPages', () => {
        it('fetches all pages discovered from page 1 pagination', async () => {
            const page1Html = `
<div class="pagination">
  <span class="pagination_current">1</span>
  <a href="showthread.php?tid=1336&amp;page=2" class="pagination_page">2</a>
</div>
<div>Page 1 Content</div>
            `;
            const page2Html = '<div>Page 2 Content</div>';

            const fetchSpy = vi.spyOn(globalThis, 'fetch');
            fetchSpy.mockResolvedValueOnce(new Response(page1Html, { status: 200 }));
            fetchSpy.mockResolvedValueOnce(new Response(page2Html, { status: 200 }));

            const pages = await fetchAllThreadPages(1336, { delayMs: 0 });

            expect(pages).toHaveLength(2);
            expect(pages[0].page).toBe(1);
            expect(pages[0].html).toContain('Page 1 Content');
            expect(pages[1].page).toBe(2);
            expect(pages[1].html).toContain('Page 2 Content');
        });
    });
});
