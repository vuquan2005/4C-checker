import { describe, it, expect } from 'vitest';
import {
    htmlToPlainText,
    parsePostEditSummary,
    parseThreadPosts,
    isImageUrl,
    cleanUrlString,
} from './thread-parser.js';

describe('Thread Parser (HTML to Plain Text, Sanitized Links & Images)', () => {
    describe('isImageUrl', () => {
        it('identifies image URLs by file extension', () => {
            expect(isImageUrl('https://example.com/drawing.png')).toBe(true);
            expect(isImageUrl('https://example.com/photo.JPG')).toBe(true);
            expect(isImageUrl('https://example.com/image.webp?w=500')).toBe(true);
        });

        it('identifies image hosting domains even without extensions', () => {
            expect(isImageUrl('https://postimg.cc/PCcKZvzg')).toBe(true);
            expect(isImageUrl('https://i.postimg.cc/3wrqsgyx/image.png')).toBe(true);
            expect(isImageUrl('https://imgur.com/gallery/abc1234')).toBe(true);
        });

        it('returns false for non-image links', () => {
            expect(
                isImageUrl(
                    'https://drive.google.com/drive/folders/14tl5qpwUohDaPRcMstpC__eErQMSVBKy?usp=sharing'
                )
            ).toBe(false);
            expect(isImageUrl('https://github.com/my-repo/project')).toBe(false);
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

        it('separates image URLs from document links even when images are wrapped in <a> tags', () => {
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

            // Only Google Drive is in links; postimg viewer URL and pic.png are in imageUrls
            expect(post.links).toEqual(['https://drive.google.com/drive/folders/folder_xyz']);
            expect(post.imageUrls).toContain('https://i.postimg.cc/sample/pic.png');
            expect(post.imageUrls).toContain('https://postimg.cc/view123');
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
    });
});
