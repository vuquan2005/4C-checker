import { describe, it, expect } from 'vitest';
import {
    htmlToPlainText,
    parsePostEditSummary,
    parseThreadPosts,
    isImageUrl,
    isImageHostViewerUrl,
    cleanUrlString,
} from './thread-parser.js';

describe('Thread Parser (HTML to Plain Text, Sanitized Links & Images)', () => {
    describe('isImageUrl & isImageHostViewerUrl', () => {
        it('identifies image URLs by file extension', () => {
            expect(isImageUrl('https://example.com/drawing.png')).toBe(true);
            expect(isImageUrl('https://example.com/photo.JPG')).toBe(true);
            expect(isImageUrl('https://example.com/image.webp?w=500')).toBe(true);
            expect(isImageUrl('https://i.postimg.cc/3wrqsgyx/image.png')).toBe(true);
        });

        it('rejects image hosting domains without file extensions from isImageUrl', () => {
            expect(isImageUrl('https://postimg.cc/PCcKZvzg')).toBe(false);
            expect(isImageUrl('https://imgur.com/gallery/abc1234')).toBe(false);
        });

        it('identifies image hosting viewer domains without extensions via isImageHostViewerUrl', () => {
            expect(isImageHostViewerUrl('https://postimg.cc/PCcKZvzg')).toBe(true);
            expect(isImageHostViewerUrl('https://imgur.com/gallery/abc1234')).toBe(true);
            // Direct image with extension is not a viewer landing page
            expect(isImageHostViewerUrl('https://i.postimg.cc/3wrqsgyx/image.png')).toBe(false);
        });

        it('returns false for non-image links', () => {
            expect(
                isImageUrl(
                    'https://drive.google.com/drive/folders/14tl5qpwUohDaPRcMstpC__eErQMSVBKy?usp=sharing'
                )
            ).toBe(false);
            expect(isImageUrl('https://github.com/my-repo/project')).toBe(false);
            expect(isImageHostViewerUrl('https://github.com/my-repo/project')).toBe(false);
        });
    });

    describe('cleanUrlString', () => {
        it('strips trailing punctuation, brackets, and quotes', () => {
            expect(cleanUrlString('https://drive.google.com/file/d/123/view?usp=sharing.')).toBe(
                'https://drive.google.com/file/d/123/view?usp=sharing'
            );
            expect(cleanUrlString('https://drive.google.com/file/d/123/view?usp=sharing)')).toBe(
                'https://drive.google.com/file/d/123/view?usp=sharing'
            );
            expect(cleanUrlString('https://drive.google.com/file/d/123/view",')).toBe(
                'https://drive.google.com/file/d/123/view'
            );
        });

        it('returns empty string for invalid or non-http URLs', () => {
            expect(cleanUrlString('')).toBe('');
            expect(cleanUrlString('not-a-url')).toBe('');
            expect(cleanUrlString('javascript:alert(1)')).toBe('');
        });
    });

    describe('htmlToPlainText', () => {
        it('converts <p> and <br> into newlines and trims lines', () => {
            const html = '<p>Dòng 1</p><span>Dòng 2</span><br>Dòng 3';
            const text = htmlToPlainText(html);
            expect(text).toBe('Dòng 1\nDòng 2\nDòng 3');
        });

        it('normalizes non-breaking spaces and HTML entities', () => {
            const html = '<div>Họ&nbsp;và&nbsp;tên:&nbsp;&lt;Hà Phúc Khánh&gt;</div>';
            const text = htmlToPlainText(html);
            expect(text).toBe('Họ và tên: <Hà Phúc Khánh>');
        });
    });

    describe('parsePostEditSummary', () => {
        it('extracts edit time and editor username', () => {
            const raw = '(Sửa đổi lần cuối: 09-29-2026, 10:06 PM bởi Nguyễn Văn A.)';
            const info = parsePostEditSummary(raw);
            expect(info).toBeDefined();
            expect(info?.editedAt).toBe('09-29-2026, 10:06 PM');
            expect(info?.editedBy).toBe('Nguyễn Văn A');
        });
    });

    describe('Parsing synthetic post HTML snippets', () => {
        it('correctly parses a well-formed submission with rendered links and images', () => {
            const html = `
<div class="post" id="post_1001">
  <div class="post_head">
    <div class="float_right"><strong><a href="#">#2</a></strong></div>
    <span class="post_date">10-01-2026, 08:30 AM</span>
  </div>
  <div class="post_author">
    <div class="author_information">
      <strong><span class="largetext"><a href="member.php?uid=5555">Student_Alpha</a></span></strong>
    </div>
  </div>
  <div class="post_body">
    Em xin nộp bài buổi 1:<br />
    <a href="https://drive.google.com/file/d/assignment123/view?usp=sharing" target="_blank">Link Drive</a><br />
    <img src="https://i.postimg.cc/sample/drawing.png" alt="Drawing" />
  </div>
</div>
            `;
            const posts = parseThreadPosts(html);
            expect(posts).toHaveLength(1);

            const post = posts[0];
            expect(post.postId).toBe('1001');
            expect(post.postNumber).toBe(2);
            expect(post.author.username).toBe('Student_Alpha');
            expect(post.author.uid).toBe('5555');
            expect(post.postDate).toBe('10-01-2026, 08:30 AM');
            expect(post.links).toEqual([
                'https://drive.google.com/file/d/assignment123/view?usp=sharing',
            ]);
            expect(post.imageUrls).toEqual(['https://i.postimg.cc/sample/drawing.png']);
            // Well-formed post has no unrendered URL warnings
            expect(post.warnings).toHaveLength(0);
        });

        it('separates image URLs from document links without duplicating viewer URL when images are wrapped in <a> tags', () => {
            const html = `
<div class="post" id="post_1002">
  <div class="post_head"><div class="float_right"><strong><a>#3</a></strong></div><span class="post_date">10-01-2026</span></div>
  <div class="post_author"><div class="author_information"><span class="largetext"><a href="member.php?uid=6666">Student_Beta</a></span></div></div>
  <div class="post_body">
    Link bài nộp: <a href="https://drive.google.com/drive/folders/folder_xyz">Drive</a><br />
    Link ảnh: <a href="https://postimg.cc/view123"><img src="https://i.postimg.cc/sample/pic.png" /></a>
  </div>
</div>
            `;
            const posts = parseThreadPosts(html);
            const post = posts[0];

            // Only Google Drive is in links; only direct pic.png is in imageUrls (no duplicate postimg viewer URL)
            expect(post.links).toEqual(['https://drive.google.com/drive/folders/folder_xyz']);
            expect(post.imageUrls).toEqual(['https://i.postimg.cc/sample/pic.png']);
        });

        it('extracts standalone direct image link with extension when not wrapping an <img> tag', () => {
            const html = `
<div class="post" id="post_1002b">
  <div class="post_head"><div class="float_right"><strong><a>#3</a></strong></div><span class="post_date">10-01-2026</span></div>
  <div class="post_author"><div class="author_information"><span class="largetext"><a href="member.php?uid=6666">Student_Beta</a></span></div></div>
  <div class="post_body">
    Xem ảnh: <a href="https://i.postimg.cc/sample/drawing.png">Bấm vào đây để xem ảnh</a>
  </div>
</div>
            `;
            const posts = parseThreadPosts(html);
            expect(posts[0].imageUrls).toEqual(['https://i.postimg.cc/sample/drawing.png']);
            expect(posts[0].warnings).toEqual([]);
        });

        it('rejects standalone image viewer page without extension and flags INVALID_IMAGE_URL', () => {
            const html = `
<div class="post" id="post_1002c">
  <div class="post_head"><div class="float_right"><strong><a>#3</a></strong></div><span class="post_date">10-01-2026</span></div>
  <div class="post_author"><div class="author_information"><span class="largetext"><a href="member.php?uid=6666">Student_Beta</a></span></div></div>
  <div class="post_body">
    Xem ảnh: <a href="https://postimg.cc/view123">Bấm vào đây để xem ảnh</a>
  </div>
</div>
            `;
            const posts = parseThreadPosts(html);
            // Viewer landing pages without extension are excluded from imageUrls and links
            expect(posts[0].imageUrls).toEqual([]);
            expect(posts[0].links).toEqual([]);
            expect(posts[0].warnings).toContain('INVALID_IMAGE_URL');
        });

        it('extracts plain-text or broken BBCode URLs into links and adds UNRENDERED_URL warning', () => {
            const html = `
<div class="post" id="post_1003">
  <div class="post_head"><div class="float_right"><strong><a>#4</a></strong></div><span class="post_date">10-01-2026</span></div>
  <div class="post_author"><div class="author_information"><span class="largetext"><a href="member.php?uid=7777">Student_Gamma</a></span></div></div>
  <div class="post_body">
    Em nộp bài dán link thô không click được:
    https://drive.google.com/file/d/raw_file_id/view[/url]
    Link ảnh thô: https://i.imgur.com/unrendered.png
  </div>
</div>
            `;
            const posts = parseThreadPosts(html);
            const post = posts[0];

            // 1. Both raw/broken links ARE STILL successfully extracted
            expect(post.links).toContain('https://drive.google.com/file/d/raw_file_id/view');
            expect(post.imageUrls).toContain('https://i.imgur.com/unrendered.png');

            // 2. Flags single unified warning UNRENDERED_URL
            expect(post.warnings).toContain('UNRENDERED_URL');
        });

        it('detects pure plain-text URLs with no BBCode tags as UNRENDERED_URL', () => {
            const html = `
<div class="post" id="post_1004">
  <div class="post_head"><div class="float_right"><strong><a>#5</a></strong></div><span class="post_date">10-01-2026</span></div>
  <div class="post_author"><div class="author_information"><span class="largetext"><a href="member.php?uid=8888">Student_Delta</a></span></div></div>
  <div class="post_body">
    Link bài tập: https://drive.google.com/drive/folders/plaintext_folder
  </div>
</div>
            `;
            const posts = parseThreadPosts(html);
            const post = posts[0];

            expect(post.links).toEqual(['https://drive.google.com/drive/folders/plaintext_folder']);
            expect(post.warnings).toEqual(['UNRENDERED_URL']);
        });

        it('detects unrendered image URLs and broken BBCode tags even if a rendered <img> also exists in post', () => {
            const html = `
<div class="post" id="post_2001">
  <div class="post_head"><div class="float_right"><strong><a>#2</a></strong></div><span class="post_date">10-01-2026</span></div>
  <div class="post_author"><div class="author_information"><span class="largetext"><a href="member.php?uid=27380">Nguyen_Tien_Dat</a></span></div></div>
  <div class="post_body">
    Link ảnh: [/url]<br />
    [url=https://i.postimg.cc/9MgpW1VJ/Screenshot-(20).png]<img src="https://i.postimg.cc/9MgpW1VJ/Screenshot-(20).png" class="mycode_img">
  </div>
</div>
            `;
            const posts = parseThreadPosts(html);
            const post = posts[0];

            expect(post.warnings).toContain('UNRENDERED_URL');
            expect(post.warnings).toContain('MALFORMED_BBCODE');
            expect(post.imageUrls).toEqual(['https://i.postimg.cc/9MgpW1VJ/Screenshot-(20).png']);
        });

        it('extracts direct post permalink (postUrl) from the index post anchor', () => {
            const html = `
<div class="post" id="post_26106">
  <div class="post_head">
    <div class="float_right"><strong><a href="showthread.php?tid=1336&amp;pid=26106#pid26106">#5</a></strong></div>
    <span class="post_date">10-01-2026</span>
  </div>
  <div class="post_body">Nội dung bài viết #5</div>
</div>
            `;
            const posts = parseThreadPosts(html);
            expect(posts).toHaveLength(1);
            expect(posts[0].postId).toBe('26106');
            expect(posts[0].postNumber).toBe(5);
            expect(posts[0].postUrl).toBe(
                'https://kisu4chaui.com/showthread.php?tid=1336&pid=26106#pid26106'
            );
        });

        it('supports custom baseUrl when resolving postUrl and author links', () => {
            const html = `
<div class="post" id="post_999">
  <div class="post_head">
    <div class="float_right"><strong><a href="showthread.php?tid=50&amp;pid=999#pid999">#1</a></strong></div>
    <span class="post_date">10-01-2026</span>
  </div>
  <div class="post_author">
    <a href="member.php?uid=123">User</a>
  </div>
  <div class="post_body">Hello</div>
</div>
            `;
            const posts = parseThreadPosts(html, 'https://myforum.org');
            expect(posts[0].postUrl).toBe(
                'https://myforum.org/showthread.php?tid=50&pid=999#pid999'
            );
            expect(posts[0].author.uid).toBe('123');
        });

        it('automatically detects baseUrl from author links in post without passing baseUrl', () => {
            const html = `
<div class="post" id="post_555">
  <div class="post_head">
    <div class="float_right"><strong><a href="showthread.php?tid=99&amp;pid=555#pid555">#1</a></strong></div>
    <span class="post_date">10-01-2026</span>
  </div>
  <div class="post_author">
    <a href="https://autodetected-forum.com/member.php?uid=777">User</a>
  </div>
  <div class="post_body">Auto detect test</div>
</div>
            `;
            const posts = parseThreadPosts(html);
            expect(posts[0].postUrl).toBe(
                'https://autodetected-forum.com/showthread.php?tid=99&pid=555#pid555'
            );
        });

        it('automatically detects baseUrl from forum logo link', () => {
            const html = `
<div id="logo">
  <a href="https://another-domain.vn/index.php">Logo</a>
</div>
<div class="post" id="post_666">
  <div class="post_head">
    <div class="float_right"><strong><a href="showthread.php?tid=12&amp;pid=666#pid666">#2</a></strong></div>
    <span class="post_date">10-01-2026</span>
  </div>
  <div class="post_body">Nav auto detect test</div>
</div>
            `;
            const posts = parseThreadPosts(html);
            expect(posts[0].postUrl).toBe(
                'https://another-domain.vn/showthread.php?tid=12&pid=666#pid666'
            );
        });

        it('falls back to pid URL if index anchor href is # or missing', () => {
            const html = `
<div class="post" id="post_888">
  <div class="post_head">
    <div class="float_right"><strong><a href="#">#2</a></strong></div>
    <span class="post_date">10-01-2026</span>
  </div>
  <div class="post_body">Fallback test</div>
</div>
            `;
            const posts = parseThreadPosts(html);
            expect(posts[0].postUrl).toBe('https://kisu4chaui.com/showthread.php?pid=888#pid888');
        });
    });
});
