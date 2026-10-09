import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { parseThreadIdInput } from './network.js';
import { syncThread, readTextFileAutoEncoding } from '../index.js';

/**
 * Đăng ký các câu lệnh đồng bộ và chuẩn bị dữ liệu (prepare-thread / sync)
 */
export function registerPrepareCommands(program: Command): void {
    program
        .command('prepare-thread')
        .alias('prep')
        .alias('sync')
        .description(
            'Thu thập, đồng bộ dữ liệu bài nộp từ diễn đàn và trích xuất CAD vào cấu trúc thư mục'
        )
        .argument('<thread-id-or-url>', 'ID chủ đề (ví dụ: 1336) hoặc link diễn đàn')
        .option('-d, --data-dir <dir>', 'Thư mục gốc lưu trữ dữ liệu (mặc định: ./data)', './data')
        .option('-i, --input <file>', 'Đọc từ file HTML có sẵn thay vì tải từ diễn đàn')
        .option(
            '-m, --metadata-only',
            'Chỉ đồng bộ metadata và lịch sử vào thread.json, không tải file CAD/ảnh',
            false
        )
        .option('--force', 'Tải lại toàn bộ dữ liệu dù đã tồn tại trên đĩa', false)
        .option('--post <id-or-num>', 'Chỉ lọc và đồng bộ một bài viết cụ thể')
        .option('--concurrency <n>', 'Số luồng xử lý đồng thời (mặc định: 2)', '2')
        .option('--no-images', 'Bỏ qua tải ảnh forum BBCode')
        .option('--no-drive', 'Bỏ qua tải file từ Google Drive')
        .option('--no-cad', 'Bỏ qua quét và trích xuất ảnh 3D CAD preview')
        .option('--include-op', 'Bao gồm cả bài viết mở đầu (OP / Thread Starter)', false)
        .option('--json', 'Xuất kết quả tóm tắt dưới dạng JSON', false)
        .action(
            async (
                input: string,
                options: {
                    dataDir: string;
                    input?: string;
                    metadataOnly?: boolean;
                    force?: boolean;
                    post?: string;
                    concurrency: string;
                    images?: boolean;
                    drive?: boolean;
                    cad?: boolean;
                    includeOp?: boolean;
                    json?: boolean;
                }
            ) => {
                try {
                    const threadId = parseThreadIdInput(input);
                    if (!threadId) {
                        console.error(pc.red('\n❌ Thread ID không hợp lệ.\n'));
                        process.exit(1);
                    }

                    let htmlContent: string | undefined;
                    if (options.input) {
                        const targetFile = path.resolve(process.cwd(), options.input);
                        if (!fs.existsSync(targetFile)) {
                            console.error(pc.red(`\n❌ Không tìm thấy file HTML: ${targetFile}\n`));
                            process.exit(1);
                        }
                        htmlContent = readTextFileAutoEncoding(targetFile);
                    }

                    if (!options.json) {
                        console.log(
                            pc.cyan(
                                `\n🚀 Bắt đầu đồng bộ dữ liệu cho Thread #${pc.bold(threadId)}...`
                            )
                        );
                        if (options.metadataOnly) {
                            console.log(
                                pc.yellow('ℹ️ Chế độ Metadata-Only: Không tải tệp và ảnh.')
                            );
                        }
                    }

                    const summary = await syncThread(threadId, {
                        dataDir: options.dataDir,
                        htmlContent,
                        metadataOnly: options.metadataOnly,
                        force: options.force,
                        targetPostId: options.post,
                        ignoreOp: !options.includeOp,
                        concurrency: parseInt(options.concurrency, 10) || 2,
                        downloadImages: options.images !== false,
                        downloadDrive: options.drive !== false,
                        extractCad: options.cad !== false,
                        onProgress: (event) => {
                            if (options.json) return;
                            if (event.type === 'post_start' && event.post) {
                                process.stdout.write(
                                    `  ⏳ [${event.completed! + 1}/${event.total}] Post #${event.post.postNumber} (${event.post.author.username})...\r`
                                );
                            } else if (event.type === 'post_done' && event.post) {
                                console.log(
                                    `  ✓ [${event.completed}/${event.total}] Hoàn thành Post #${event.post.postNumber} (${event.post.author.username})`
                                );
                            } else if (event.type === 'manifest_updated') {
                                console.log(pc.green(`  ✓ ${event.message}`));
                            } else if (event.type === 'posts_parsed') {
                                console.log(pc.gray(`  ℹ️ ${event.message}`));
                            }
                        },
                    });

                    if (options.json) {
                        console.log(
                            JSON.stringify(
                                {
                                    threadId: summary.threadId,
                                    totalDiscovered: summary.totalDiscoveredPosts,
                                    newPosts: summary.newPostsCount,
                                    editedPosts: summary.editedPostsCount,
                                    unchangedPosts: summary.unchangedPostsCount,
                                    processedPosts: summary.processedPostsCount,
                                    failedPosts: summary.failedPostsCount,
                                    durationMs: summary.durationMs,
                                    manifestStats: summary.manifest.stats,
                                },
                                null,
                                2
                            )
                        );
                        return;
                    }

                    console.log(pc.green(`\n✨ ĐỒNG BỘ THÀNH CÔNG THREAD #${threadId}\n`));
                    console.log(
                        [
                            `  - Tổng số bài nộp tìm thấy: ${pc.bold(summary.totalDiscoveredPosts.toString())}`,
                            `  - Số tác giả (học viên):    ${pc.bold(summary.manifest.stats.totalUsers.toString())}`,
                            `  - Bài nộp mới:              ${pc.green(summary.newPostsCount.toString())}`,
                            `  - Bài nộp sửa đổi:          ${summary.editedPostsCount > 0 ? pc.yellow(summary.editedPostsCount.toString()) : '0'}`,
                            `  - Bài nộp không đổi (skip): ${pc.gray(summary.unchangedPostsCount.toString())}`,
                            `  - Đã tải & xử lý dữ liệu:   ${pc.bold(summary.processedPostsCount.toString())}`,
                            summary.failedPostsCount > 0
                                ? `  - Số bài lỗi khi tải:       ${pc.red(summary.failedPostsCount.toString())}`
                                : '',
                            `  - Thời gian thực thi:       ${(summary.durationMs / 1000).toFixed(2)}s`,
                            `  - Thư mục lưu trữ:          ${pc.cyan(path.join(options.dataDir, threadId))}`,
                        ]
                            .filter(Boolean)
                            .join('\n') + '\n'
                    );

                    console.log(
                        pc.gray(
                            `💡 Gợi ý tiếp theo: Chạy phân tích dữ liệu đã chuẩn bị bằng lệnh:\n   4c-checker analyze ${threadId}\n`
                        )
                    );
                } catch (err) {
                    console.error(pc.red(`\n❌ Lỗi đồng bộ: ${(err as Error).message}\n`));
                    process.exit(1);
                }
            }
        );
}
