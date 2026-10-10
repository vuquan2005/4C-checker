import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { analyzeThread } from '../analysis/orchestrator.js';
import { parseThreadIdInput } from './network.js';

/**
 * Registers the 'analyze' CLI command
 */
export function registerAnalyzeCommands(program: Command): void {
    program
        .command('analyze')
        .alias('check')
        .description(
            'Phân tích bài tập sinh viên, so khớp chéo RSe & metadata CAD để phát hiện gian lận và đánh giá tiêu chí'
        )
        .argument('<thread-id-or-url>', 'ID chủ đề (ví dụ: 1336) hoặc link diễn đàn')
        .option('-d, --data-dir <dir>', 'Thư mục gốc lưu trữ dữ liệu (mặc định: ./data)', './data')
        .option('-c, --config <file>', 'Đường dẫn tới file cấu hình JSON tùy chỉnh')
        .option(
            '-o, --output <file>',
            'Đường dẫn file báo cáo xuất ra (mặc định: data/<threadId>/analysis.json)'
        )
        .option('-s, --session <n>', 'Chỉ phân tích một buổi học cụ thể (ví dụ: -s 1)')
        .option('--no-save', 'Không ghi file analysis.json xuống đĩa, chỉ in kết quả')
        .option('--json', 'Xuất toàn bộ kết quả phân tích dưới dạng JSON ra stdout', false)
        .action(
            async (
                input: string,
                options: {
                    dataDir: string;
                    config?: string;
                    output?: string;
                    session?: string;
                    save?: boolean;
                    json?: boolean;
                }
            ) => {
                const threadId = parseThreadIdInput(input);
                const targetSession = options.session ? Number(options.session) : undefined;

                if (!options.json) {
                    console.log(
                        pc.blue(pc.bold('=== 4C-CHECKER: PHÂN TÍCH CAD & PHÁT HIỆN GIAN LẬN ==='))
                    );
                    console.log(pc.gray(`Thread ID   : ${threadId}`));
                    console.log(pc.gray(`Thư mục data: ${path.resolve(options.dataDir)}`));
                    if (targetSession) {
                        console.log(pc.cyan(`Lọc theo buổi: Buổi ${targetSession}`));
                    }
                    console.log('');
                }

                try {
                    const report = await analyzeThread(threadId, {
                        dataDir: options.dataDir,
                        configPath: options.config,
                        outputPath: options.output,
                        saveReport: options.save !== false,
                        targetSession,
                    });

                    if (options.json) {
                        console.log(JSON.stringify(report, null, 2));
                        return;
                    }

                    // Print formatted CLI summary
                    console.log(pc.green(pc.bold('✔ Phân tích hoàn tất!')));
                    console.log(
                        pc.gray(
                            `Thời gian thực hiện: ${new Date(report.analyzedAt).toLocaleString('vi-VN')}`
                        )
                    );
                    console.log('');

                    // 1. Overview Statistics
                    console.log(pc.bold('📊 THỐNG KÊ TỔNG QUAN:'));
                    console.log(
                        `- Tổng số bài viết phát hiện: ${pc.bold(report.stats.totalPostsDiscovered)}`
                    );
                    console.log(
                        `- Số bài viết đã phân tích  : ${pc.cyan(report.stats.totalPostsAnalyzed)}`
                    );
                    console.log(
                        `- Số bài viết bị bỏ qua     : ${pc.gray(report.stats.totalPostsSkipped)}`
                    );
                    console.log(
                        `- Tổng số sinh viên         : ${pc.bold(report.stats.totalStudents)}`
                    );
                    console.log(
                        `- Tổng số tệp CAD           : ${pc.yellow(report.stats.totalCadFiles)}`
                    );
                    console.log(
                        `- Số sinh viên bị cảnh báo  : ${
                            report.stats.suspiciousStudentsCount > 0
                                ? pc.red(pc.bold(report.stats.suspiciousStudentsCount))
                                : pc.green('0')
                        }`
                    );
                    console.log('');

                    // 2. Plagiarism Clusters
                    console.log(pc.bold('🚨 KẾT QUẢ PHÁT HIỆN GIAN LẬN / TRÙNG LẶP:'));
                    if (report.allClusters.length === 0) {
                        console.log(
                            pc.green('✔ Không phát hiện cụm trùng lặp tệp CAD nào nghi vấn.')
                        );
                    } else {
                        console.log(
                            `Tìm thấy ${pc.red(pc.bold(report.allClusters.length))} cụm nghi vấn (` +
                                `${pc.red(report.stats.highSeverityClustersCount + ' Nghiêm trọng')}, ` +
                                `${pc.yellow(report.stats.mediumSeverityClustersCount + ' Trung bình')}, ` +
                                `${pc.gray(report.stats.lowSeverityClustersCount + ' Thấp')})`
                        );
                        console.log('');

                        for (const cluster of report.allClusters) {
                            const badge =
                                cluster.severity === 'high'
                                    ? pc.bgRed(pc.white(pc.bold(' HIGH ')))
                                    : cluster.severity === 'medium'
                                      ? pc.bgYellow(pc.black(pc.bold(' MEDIUM ')))
                                      : pc.gray(' [LOW] ');

                            const sessionTag =
                                cluster.sessionIndex !== undefined
                                    ? pc.cyan(`[Buổi ${cluster.sessionIndex}]`)
                                    : pc.magenta('[Xuyên Buổi]');

                            console.log(`${badge} ${sessionTag} ${pc.bold(cluster.title)}`);
                            console.log(`   ${pc.gray('Mô tả:')} ${cluster.description}`);

                            if (cluster.suspectedOriginal) {
                                console.log(
                                    `   ${pc.green('★ Bản gốc nghi vấn:')} ${cluster.suspectedOriginal.fileName} (${cluster.suspectedOriginal.author.username} - #${cluster.suspectedOriginal.postNumber}) nộp lúc ${cluster.suspectedOriginal.postDate}`
                                );
                            }

                            if (cluster.suspectedCopies.length > 0) {
                                console.log(`   ${pc.red('⚠ Bản sao nghi vấn:')}`);
                                for (const copy of cluster.suspectedCopies) {
                                    console.log(
                                        `     - ${copy.fileName} (${copy.author.username} - #${copy.postNumber}) nộp lúc ${copy.postDate}`
                                    );
                                }
                            }

                            console.log(`   ${pc.gray('Bằng chứng forensic:')}`);
                            for (const ev of cluster.evidence) {
                                console.log(`     • ${ev}`);
                            }
                            console.log('');
                        }
                    }

                    // 3. Session Summaries
                    console.log(pc.bold('📅 TỔNG KẾT THEO TỪNG BUỔI HỌC:'));
                    for (const [sKey, session] of Object.entries(report.sessions)) {
                        const sNum = sKey === '0' ? 'Không xác định' : `Buổi ${sKey}`;
                        console.log(
                            pc.cyan(
                                `[${sNum}] ${session.title ?? ''}: ${session.totalSubmissions} bài nộp | ` +
                                    `${pc.green(session.passedSubmissionsCount + ' Đạt')} | ` +
                                    `${session.failedSubmissionsCount > 0 ? pc.red(session.failedSubmissionsCount + ' Vi phạm') : '0 Vi phạm'} | ` +
                                    `${session.lateSubmissionsCount > 0 ? pc.yellow(session.lateSubmissionsCount + ' Nộp trễ') : '0 Nộp trễ'}`
                            )
                        );
                    }
                    console.log('');

                    // 4. Detailed Post Warnings & Violations
                    const warnedPosts: (typeof report.sessions)[string]['posts'] = [];
                    for (const session of Object.values(report.sessions)) {
                        for (const post of session.posts) {
                            const hasActiveSessionWarning = post.sessionWarnings.some(
                                (s) => !s.startsWith('SESSION_OVERRIDE_APPLIED:')
                            );
                            if (
                                post.criteriaViolations.length > 0 ||
                                hasActiveSessionWarning ||
                                post.urlWarnings.length > 0 ||
                                post.driveWarnings.length > 0 ||
                                post.imageWarnings.length > 0
                            ) {
                                warnedPosts.push(post);
                            }
                        }
                    }

                    if (warnedPosts.length > 0) {
                        console.log(
                            pc.bold(
                                `⚠️  DANH SÁCH BÀI VIẾT CÓ CẢNH BÁO HOẶC VI PHẠM (${warnedPosts.length} bài):`
                            )
                        );

                        for (const post of warnedPosts) {
                            const sessionLabel =
                                post.sessionIndex !== undefined && post.sessionIndex > 0
                                    ? `Buổi ${post.sessionIndex}`
                                    : pc.red('Chưa xác định buổi');
                            console.log(
                                pc.bold(`• Bài #${post.postNumber}`) +
                                    ` (${pc.cyan(post.author.username)}) - [${sessionLabel}] (Post ID: ${post.postId}):`
                            );

                            // Criteria Violations (Session, Drive, Deadline, CAD files, Images...)
                            for (const v of post.criteriaViolations) {
                                console.log(pc.red(`    ❌ Vi phạm   : ${v}`));
                            }

                            // Session override notifications (only if successfully resolved by override)
                            for (const s of post.sessionWarnings) {
                                if (s.startsWith('SESSION_OVERRIDE_APPLIED:')) {
                                    console.log(pc.green(`    ✔ Số buổi   : ${s}`));
                                }
                            }

                            // URL & BBCode warnings (grouped on a single line)
                            if (post.urlWarnings.length > 0) {
                                console.log(
                                    pc.yellow(`    🔗 Cú pháp   : ${post.urlWarnings.join(', ')}`)
                                );
                            }

                            // Drive warnings that are not already listed under violations
                            for (const d of post.driveWarnings) {
                                if (!post.criteriaViolations.includes(d)) {
                                    console.log(pc.blue(`    📁 GDrive    : ${d}`));
                                }
                            }

                            // Image warnings that are not already listed under violations
                            for (const imgWarn of post.imageWarnings) {
                                if (!post.criteriaViolations.includes(imgWarn)) {
                                    console.log(pc.yellow(`    🖼️ Ảnh       : ${imgWarn}`));
                                }
                            }
                        }
                        console.log('');
                    }

                    if (options.save !== false) {
                        const savedPath =
                            options.output ?? path.join(options.dataDir, threadId, 'analysis.json');
                        console.log(
                            pc.green(
                                `💾 Báo cáo chi tiết JSON đã được lưu tại: ${pc.bold(path.resolve(savedPath))}`
                            )
                        );
                    }
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.error(pc.red(`\n❌ Lỗi khi phân tích: ${message}`));
                    process.exit(1);
                }
            }
        );
}
