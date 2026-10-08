import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { parseThreadPosts, readTextFileAutoEncoding, ensureDir } from '../index.js';

/**
 * Đọc toàn bộ nội dung từ standard input (stdin)
 */
async function readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        let content = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
            content += chunk;
        });
        process.stdin.on('end', () => {
            resolve(content);
        });
        process.stdin.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Đăng ký các câu lệnh phân tích cú pháp HTML MyBB (parse-thread)
 */
export function registerParserCommands(program: Command): void {
    program
        .command('parse-thread')
        .alias('parse')
        .description(
            'Phân tích cú pháp bài viết MyBB từ file HTML, stdin (pipeline), hoặc chuỗi trực tiếp'
        )
        .argument('[file]', 'Đường dẫn file HTML (nếu bỏ trống hoặc là "-", sẽ đọc từ stdin)')
        .option('-i, --input <file>', 'Đường dẫn file HTML (cách viết tường minh với cờ -i)')
        .option('-t, --text <html-string>', 'Chuỗi HTML truyền trực tiếp thay vì đọc từ file')
        .option('--json', 'Xuất toàn bộ kết quả dưới dạng JSON (dùng tốt với jq)')
        .option('-o, --output <file>', 'Lưu kết quả phân tích ra file JSON')
        .option(
            '--post <id-or-num>',
            'Chỉ lọc xem chi tiết một bài viết cụ thể (theo số #1, #2... hoặc Post ID)'
        )
        .option('--ignore-op', 'Bỏ qua bài viết đầu tiên (OP / Thread Starter)', true)
        .option(
            '--summary',
            'Chỉ in thống kê tóm tắt, không hiển thị chi tiết từng bài viết',
            false
        )
        .action(
            async (
                fileArg: string | undefined,
                options: {
                    input?: string;
                    text?: string;
                    json?: boolean;
                    output?: string;
                    post?: string;
                    ignoreOp?: boolean;
                    summary?: boolean;
                }
            ) => {
                try {
                    let html = '';
                    let sourceLabel = 'stdin';

                    // 1. Phân giải nguồn dữ liệu HTML theo thứ tự ưu tiên rõ ràng
                    if (options.text) {
                        // Cách 1: Truyền chuỗi HTML trực tiếp qua cờ -t / --text
                        html = options.text;
                        sourceLabel = 'text';
                    } else {
                        const targetPath = options.input || fileArg;

                        if (targetPath && targetPath !== '-') {
                            // Cách 2: Truyền đường dẫn file qua đối số hoặc cờ -i
                            if (fs.existsSync(targetPath)) {
                                html = readTextFileAutoEncoding(targetPath);
                                sourceLabel =
                                    path.relative(process.cwd(), targetPath) || targetPath;
                            } else if (!process.stdin.isTTY) {
                                // Nếu tên file không tồn tại nhưng có dữ liệu pipe từ stdin
                                html = await readStdin();
                            } else {
                                console.error(pc.red(`\n❌ Không tìm thấy file: ${targetPath}\n`));
                                process.exit(1);
                            }
                        } else {
                            // Cách 3: Đọc từ stdin (khi dùng '-', không truyền file, hoặc khi được pipe)
                            if (process.stdin.isTTY && !targetPath) {
                                console.error(
                                    pc.red(
                                        '\n❌ Vui lòng cung cấp file HTML hoặc truyền dữ liệu qua pipeline (stdin).\n'
                                    )
                                );
                                console.error(pc.gray('Ví dụ sử dụng:'));
                                console.error(pc.gray('  4c-checker parse thread.html'));
                                console.error(pc.gray('  4c-checker parse -i thread.html'));
                                console.error(pc.gray('  cat thread.html | 4c-checker parse\n'));
                                process.exit(1);
                            }
                            html = await readStdin();
                        }
                    }

                    if (!html.trim()) {
                        console.error(pc.yellow('\n⚠️ Không có dữ liệu HTML đầu vào.\n'));
                        return;
                    }

                    // 2. Phân tích cú pháp bài viết
                    let posts = parseThreadPosts(html);

                    if (posts.length === 0) {
                        if (!options.json) {
                            console.log(
                                pc.yellow(
                                    `\n⚠️ Không tìm thấy bài viết nào trong dữ liệu (${sourceLabel})\n`
                                )
                            );
                        } else {
                            console.log('[]');
                        }
                        return;
                    }

                    // Lọc bỏ bài OP nếu có yêu cầu
                    if (options.ignoreOp) {
                        posts = posts.filter((p) => !p.isThreadStarter);
                    }

                    // Lọc theo Post ID hoặc Số thứ tự post
                    if (options.post) {
                        const target = options.post.replace(/^#/, '').trim();
                        posts = posts.filter(
                            (p) => p.postId === target || p.postNumber.toString() === target
                        );

                        if (posts.length === 0) {
                            if (!options.json) {
                                console.log(
                                    pc.yellow(
                                        `\n⚠️ Không tìm thấy bài viết khớp với điều kiện: "${options.post}"\n`
                                    )
                                );
                            } else {
                                console.log('[]');
                            }
                            return;
                        }
                    }

                    // Xuất JSON nếu được yêu cầu (chuẩn cho GNU pipeline / jq)
                    if (options.json) {
                        console.log(JSON.stringify(posts, null, 2));
                        return;
                    }

                    // Lưu file JSON nếu có option -o
                    if (options.output) {
                        const targetOut = path.resolve(process.cwd(), options.output);
                        ensureDir(path.dirname(targetOut));
                        fs.writeFileSync(targetOut, JSON.stringify(posts, null, 2), 'utf8');
                        console.log(
                            pc.green(
                                `\n✓ Đã lưu kết quả phân tích (${posts.length} bài) vào: ${targetOut}\n`
                            )
                        );
                        if (!options.summary) return;
                    }

                    // Thống kê tổng hợp
                    const authors = new Set(posts.map((p) => p.author.username));
                    const totalLinks = posts.reduce((acc, p) => acc + p.links.length, 0);
                    const totalImages = posts.reduce((acc, p) => acc + p.imageUrls.length, 0);
                    const warningPosts = posts.filter((p) => p.warnings.length > 0);

                    if (options.summary) {
                        console.log(
                            [
                                `- Tổng số bài viết:      ${pc.bold(posts.length.toString())}`,
                                `- Số tác giả (học viên): ${pc.bold(authors.size.toString())}`,
                                `- Liên kết Drive/Tệp:    ${pc.bold(totalLinks.toString())}`,
                                `- Ảnh sản phẩm bài làm:  ${pc.bold(totalImages.toString())}`,
                                warningPosts.length > 0
                                    ? `- Cảnh báo lỗi cú pháp:   ${pc.yellow(warningPosts.length.toString())} bài viết`
                                    : '',
                            ]
                                .filter(Boolean)
                                .join('\n') + '\n'
                        );
                        return;
                    }

                    // Hiển thị danh sách từng bài viết
                    for (const p of posts) {
                        const postNumLabel = pc.bold(pc.yellow(`[#${p.postNumber}]`));
                        const authorLabel = pc.bold(p.author.username);
                        const uidLabel = p.author.uid ? pc.gray(`(uid: ${p.author.uid})`) : '';
                        const dateLabel = pc.dim(p.postDate);
                        const starterTag = p.isThreadStarter
                            ? pc.bgMagenta(pc.white(' OP ')) + ' '
                            : '';

                        console.log(
                            `\n${postNumLabel} ${starterTag}${authorLabel} ${uidLabel} • ${dateLabel} [ID: ${p.postId}]`
                        );

                        if (p.editedInfo) {
                            console.log(
                                pc.gray(
                                    `    ✏️ Sửa lần cuối: ${p.editedInfo.editedAt || 'N/A'} bởi ${p.editedInfo.editedBy || 'N/A'}`
                                )
                            );
                        }

                        // Hiển thị links
                        if (p.links.length > 0) {
                            console.log(pc.cyan(`    🔗 Liên kết tài liệu (${p.links.length}):`));
                            for (const l of p.links) {
                                console.log(`       - ${pc.underline(l)}`);
                            }
                        }

                        // Hiển thị images
                        if (p.imageUrls.length > 0) {
                            console.log(pc.magenta(`    🖼️ Ảnh sản phẩm (${p.imageUrls.length}):`));
                            for (const img of p.imageUrls) {
                                console.log(`       - ${pc.underline(img)}`);
                            }
                        }

                        // Hiển thị warnings nếu có
                        if (p.warnings.length > 0) {
                            console.log(
                                pc.yellow(`    ⚠️ Cảnh báo cú pháp: ${p.warnings.join(', ')}`)
                            );
                        }

                        // Preview plain text (lấy 3 dòng đầu)
                        const previewLines = p.plainText
                            .split('\n')
                            .filter((l) => l.trim().length > 0)
                            .slice(0, 3);
                        if (previewLines.length > 0) {
                            console.log(pc.gray(`    📝 Nội dung:`));
                            for (const line of previewLines) {
                                console.log(pc.gray(`       | ${line}`));
                            }
                        }
                    }
                    console.log('');
                } catch (err) {
                    console.error(pc.red(`\n❌ Lỗi phân tích: ${(err as Error).message}\n`));
                    process.exit(1);
                }
            }
        );
}
