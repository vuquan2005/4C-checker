import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { analyzeThread } from '../analysis/orchestrator.js';
import { printAnalysisConsoleReport } from '../analysis/reporter/index.js';
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
                    printAnalysisConsoleReport(report);

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
