import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as standardInput, stderr as standardError } from 'node:process';
import { Command } from 'commander';
import pc from 'picocolors';
import { parseThreadIdInput } from './network.js';
import {
    syncThread,
    readTextFileAutoEncoding,
    loadThreadConfig,
    type ThreadConfig,
} from '../index.js';

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
        .option('-c, --config <file>', 'Đường dẫn tới file cấu hình JSON tùy chỉnh')
        .option(
            '--ignore-post <ids...>',
            'Danh sách Post ID cần bỏ qua (ví dụ: --ignore-post 26090 26145)'
        )
        .option(
            '--ignore-uid <uids...>',
            'Danh sách User UID cần bỏ qua (ví dụ: --ignore-uid 27392 27380)'
        )
        .option(
            '--session-override <pairs...>',
            'Ghi đè số buổi theo cặp postId:session (ví dụ: --session-override 26123:2 26167:3)'
        )
        .option('-f, --force', 'Tải lại toàn bộ dữ liệu dù đã tồn tại trên đĩa', false)
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
                    config?: string;
                    ignorePost?: string[];
                    ignoreUid?: string[];
                    sessionOverride?: string[];
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

                    let customConfig: ThreadConfig | undefined;
                    if (options.ignorePost || options.ignoreUid || options.sessionOverride) {
                        customConfig = loadThreadConfig({
                            dataDir: options.dataDir,
                            threadId,
                            customPath: options.config,
                        });
                        if (options.ignorePost) {
                            const postList = options.ignorePost.flatMap((p) =>
                                p.split(',').map((x) => x.trim())
                            );
                            customConfig.prepare!.ignore!.postIds = [
                                ...new Set([
                                    ...(customConfig.prepare?.ignore?.postIds || []),
                                    ...postList,
                                ]),
                            ];
                        }
                        if (options.ignoreUid) {
                            const uidList = options.ignoreUid.flatMap((u) =>
                                u.split(',').map((x) => x.trim())
                            );
                            customConfig.prepare!.ignore!.uids = [
                                ...new Set([
                                    ...(customConfig.prepare?.ignore?.uids || []),
                                    ...uidList,
                                ]),
                            ];
                        }
                        if (options.sessionOverride) {
                            if (!customConfig.prepare) customConfig.prepare = {};
                            if (!customConfig.prepare.session) customConfig.prepare.session = {};
                            if (!customConfig.prepare.session.overrides) {
                                customConfig.prepare.session.overrides = {};
                            }
                            for (const pair of options.sessionOverride) {
                                const [pid, sStr] = pair.split(':');
                                const sNum = parseInt(sStr, 10);
                                if (pid && !isNaN(sNum) && sNum > 0) {
                                    customConfig.prepare.session.overrides[pid.trim()] = sNum;
                                }
                            }
                        }
                    }

                    const summary = await syncThread(threadId, {
                        dataDir: options.dataDir,
                        htmlContent,
                        configPath: options.config,
                        config: customConfig,
                        metadataOnly: options.metadataOnly,
                        force: options.force,
                        targetPostId: options.post,
                        ignoreOp: !options.includeOp,
                        concurrency: parseInt(options.concurrency, 10) || 2,
                        downloadImages: options.images !== false,
                        downloadDrive: options.drive !== false,
                        extractCad: options.cad !== false,
                        onSessionConflict:
                            options.json || !standardInput.isTTY
                                ? undefined
                                : async (record, declaredSession, inferredSession) => {
                                      const prompt = readline.createInterface({
                                          input: standardInput,
                                          output: standardError,
                                      });
                                      try {
                                          while (true) {
                                              const answer = await prompt.question(
                                                  `\n⚠️ Conflict session ở Post #${record.postNumber} (${record.author.username}): ` +
                                                      `bài ghi buổi ${declaredSession}, suy luận buổi ${inferredSession}.\n` +
                                                      `Chọn sessionOverride [${declaredSession}/${inferredSession}/s để bỏ qua]: `
                                              );
                                              const value = answer.trim().toLowerCase();
                                              if (value === 's' || value === 'skip')
                                                  return undefined;

                                              const sessionOverride = Number(value);
                                              if (
                                                  Number.isInteger(sessionOverride) &&
                                                  sessionOverride > 0
                                              ) {
                                                  return sessionOverride;
                                              }

                                              standardError.write(
                                                  'Vui lòng nhập số buổi hợp lệ hoặc s để bỏ qua.\n'
                                              );
                                          }
                                      } finally {
                                          prompt.close();
                                      }
                                  },
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
