import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import {
    fetchThreadPage,
    extractTotalPages,
    fetchAllThreadPages,
    getMyBbCookie,
    ensureDir,
    downloadGDriveSubmission,
} from '../index.js';

/**
 * Trích xuất Thread ID từ chuỗi số hoặc URL MyBB
 */
export function parseThreadIdInput(input: string): string {
    const trimmed = input.trim();
    const tidMatch = trimmed.match(/[?&]tid=(\d+)/);
    if (tidMatch) {
        return tidMatch[1];
    }
    const numMatch = trimmed.match(/^\d+$/);
    if (numMatch) {
        return trimmed;
    }
    return trimmed;
}

/**
 * Đăng ký các câu lệnh mạng (fetch-thread)
 */
export function registerNetworkCommands(program: Command): void {
    program
        .command('fetch-thread')
        .alias('fetch')
        .description(
            'Tải nội dung HTML chủ đề từ diễn đàn MyBB (hỗ trợ phân trang, cookie và nối tiếp pipe)'
        )
        .argument('<thread-id-or-url>', 'ID chủ đề (ví dụ: 1336) hoặc link diễn đàn')
        .option('-p, --page <number>', 'Trang cần tải (mặc định: 1)', '1')
        .option('-a, --all', 'Tải toàn bộ các trang của chủ đề')
        .option('-o, --output <file>', 'Đường dẫn lưu file HTML đầu ra')
        .option('-c, --cookie <string>', 'Cookie phiên MyBB (mặc định tự lấy từ file .env)')
        .option('--base-url <url>', 'URL gốc của diễn đàn', 'https://kisu4chaui.com')
        .option('--delay <ms>', 'Khoảng nghỉ giữa các trang khi tải all (ms)', '300')
        .option('--max-pages <number>', 'Giới hạn số trang tối đa khi tải all', '0')
        .option('--stdout', 'In nội dung HTML trực tiếp ra stdout để truyền pipe')
        .action(
            async (
                input: string,
                options: {
                    page: string;
                    all?: boolean;
                    output?: string;
                    cookie?: string;
                    baseUrl: string;
                    delay: string;
                    maxPages: string;
                    stdout?: boolean;
                }
            ) => {
                try {
                    const threadId = parseThreadIdInput(input);
                    if (!threadId || !/^\d+$/.test(threadId)) {
                        console.error(pc.red(`\n❌ Thread ID không hợp lệ: "${input}"\n`));
                        process.exit(1);
                    }

                    // Tự động nhận diện chế độ pipe ra stdout nếu stdout không phải TTY và không có -o
                    const isStdoutMode = Boolean(
                        options.stdout || (!process.stdout.isTTY && !options.output)
                    );

                    const cookie = getMyBbCookie(options.cookie);
                    const pageNum = parseInt(options.page, 10) || 1;
                    const delayMs = parseInt(options.delay, 10) || 300;
                    const maxPages = parseInt(options.maxPages, 10) || 0;

                    if (!isStdoutMode) {
                        console.log(pc.bold(pc.cyan(`\nTải chủ đề MyBB (TID: ${threadId})`)));
                        if (cookie) {
                            console.log(pc.gray(`- Phiên đăng nhập: Đã nạp Cookie`));
                        } else {
                            console.log(
                                pc.yellow(
                                    `- Cảnh báo: Không có cookie. Nếu diễn đàn yêu cầu đăng nhập, hãy thêm MYBB_COOKIE vào .env`
                                )
                            );
                        }
                    }

                    if (options.all) {
                        // Tải toàn bộ các trang
                        if (isStdoutMode) {
                            process.stderr.write(
                                `Đang tải tất cả các trang của thread ${threadId}...\n`
                            );
                        } else {
                            console.log(`- Đang kết nối tới ${options.baseUrl}...`);
                        }

                        const pages = await fetchAllThreadPages(threadId, {
                            baseUrl: options.baseUrl,
                            cookie,
                            delayMs,
                            maxPages,
                        });

                        const combinedHtml = pages
                            .map((p) => p.html)
                            .join('\n<!-- PAGE_BREAK -->\n');

                        if (isStdoutMode) {
                            process.stdout.write(combinedHtml);
                            return;
                        }

                        const totalSize = pages.reduce((acc, p) => acc + p.html.length, 0);
                        console.log(
                            pc.green(
                                `✓ Đã tải thành công ${pages.length} trang (${(totalSize / 1024).toFixed(1)} KB tổng cộng)`
                            )
                        );

                        const targetFile =
                            options.output ||
                            path.join(process.cwd(), `thread_${threadId}_all.html`);

                        ensureDir(path.dirname(targetFile));
                        fs.writeFileSync(targetFile, combinedHtml, 'utf8');
                        console.log(pc.green(`✓ Đã lưu nội dung HTML vào: ${targetFile}\n`));
                    } else {
                        // Tải 1 trang cụ thể
                        if (!isStdoutMode) {
                            console.log(`- Đang tải trang ${pageNum}...`);
                        }

                        const html = await fetchThreadPage(threadId, pageNum, {
                            baseUrl: options.baseUrl,
                            cookie,
                        });

                        if (isStdoutMode) {
                            process.stdout.write(html);
                            return;
                        }

                        const detectedTotalPages = extractTotalPages(html);
                        console.log(
                            pc.green(
                                `✓ Đã tải trang ${pageNum}/${detectedTotalPages} (${(html.length / 1024).toFixed(1)} KB)`
                            )
                        );

                        const targetFile =
                            options.output ||
                            path.join(process.cwd(), `thread_${threadId}_p${pageNum}.html`);

                        ensureDir(path.dirname(targetFile));
                        fs.writeFileSync(targetFile, html, 'utf8');
                        console.log(pc.green(`✓ Đã lưu nội dung HTML vào: ${targetFile}\n`));
                    }
                } catch (err) {
                    console.error(pc.red(`\n❌ Lỗi tải thread: ${(err as Error).message}\n`));
                    process.exit(1);
                }
            }
        );

    program
        .command('download-drive')
        .alias('drive')
        .description(
            'Tải bài nộp CAD từ Google Drive (hỗ trợ khớp thư mục buổi, xuyên thư mục đệm và stream trực tiếp)'
        )
        .argument('<drive-url>', 'URL chia sẻ Google Drive (link folder hoặc file)')
        .option('-o, --output <dir>', 'Thư mục đích lưu file tải về', 'downloads/drive')
        .option(
            '-k, --keyword <keywords...>',
            'Từ khóa ưu tiên tìm thư mục buổi (ví dụ: "buoi 1" "b1")'
        )
        .option('--ext <extensions...>', 'Danh sách đuôi file cho phép tải')
        .option('--no-skip', 'Tải lại kể cả khi file đã tồn tại trên ổ đĩa')
        .option('--no-extract', 'Không tự động giải nén file .zip sau khi tải')
        .option('--concurrency <number>', 'Số luồng tải đồng thời', '2')
        .option('--delay <ms>', 'Khoảng nghỉ giữa các lượt tải file (ms)', '300')
        .action(
            async (
                driveUrl: string,
                options: {
                    output: string;
                    keyword?: string[];
                    ext?: string[];
                    skip?: boolean;
                    extract?: boolean;
                    concurrency: string;
                    delay: string;
                }
            ) => {
                try {
                    const destDir = path.resolve(process.cwd(), options.output);
                    console.log(pc.bold(`\n📂 Bắt đầu tải bài nộp Google Drive:`));
                    console.log(`- Nguồn URL:  ${pc.cyan(driveUrl)}`);
                    console.log(`- Thư mục:    ${pc.dim(destDir)}`);
                    if (options.keyword && options.keyword.length > 0) {
                        console.log(`- Từ khóa:    ${pc.yellow(options.keyword.join(', '))}`);
                    }

                    const concurrency = parseInt(options.concurrency, 10) || 2;
                    const delayMs = parseInt(options.delay, 10) || 300;

                    const result = await downloadGDriveSubmission(driveUrl, destDir, {
                        keywords: options.keyword,
                        allowedExtensions: options.ext,
                        skipIfExists: options.skip !== false,
                        autoExtractZip: options.extract !== false,
                        concurrency,
                        delayMs,
                        onProgress: (done, total, fileName) => {
                            console.log(
                                pc.dim(`  [${done}/${total}] `) + pc.green(`✓ Đã tải: ${fileName}`)
                            );
                        },
                    });

                    if (result.matchedFolder) {
                        console.log(pc.cyan(`\n📁 Khớp thư mục buổi: "${result.matchedFolder}"`));
                    }

                    if (result.warnings.length > 0) {
                        for (const w of result.warnings) {
                            console.log(pc.yellow(`⚠️  ${w}`));
                        }
                    }

                    if (result.success) {
                        const totalKb = (result.totalBytes / 1024).toFixed(1);
                        console.log(
                            pc.green(
                                `\n🎉 Hoàn tất! Đã tải ${result.downloadedFiles.length} file, bỏ qua ${result.skippedFiles.length} file (${totalKb} KB tổng cộng).\n`
                            )
                        );
                    } else {
                        console.error(pc.red(`\n❌ Không tải được file nào từ liên kết trên.\n`));
                        process.exit(1);
                    }
                } catch (err) {
                    console.error(pc.red(`\n❌ Lỗi tải Drive: ${(err as Error).message}\n`));
                    process.exit(1);
                }
            }
        );
}
