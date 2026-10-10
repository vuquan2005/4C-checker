/**
 * Console Reporter
 * Formats and prints colorized thread analysis reports to stdout.
 */
import pc from 'picocolors';
import type {
    AnalysisSummaryStats,
    PlagiarismCluster,
    PostAnalysisResult,
    SessionAnalysisSummary,
    ThreadAnalysisReport,
} from '../types/index.js';

/**
 * Prints overview metrics to console
 */
export function printOverviewStats(stats: AnalysisSummaryStats): void {
    console.log(pc.bold('📊 THỐNG KÊ TỔNG QUAN:'));
    console.log(`- Tổng số bài viết phát hiện: ${pc.bold(stats.totalPostsDiscovered)}`);
    console.log(`- Số bài viết đã phân tích  : ${pc.cyan(stats.totalPostsAnalyzed)}`);
    console.log(`- Số bài viết bị bỏ qua     : ${pc.gray(stats.totalPostsSkipped)}`);
    console.log(`- Tổng số sinh viên         : ${pc.bold(stats.totalStudents)}`);
    console.log(`- Tổng số tệp CAD           : ${pc.yellow(stats.totalCadFiles)}`);
    console.log(
        `- Số sinh viên bị cảnh báo  : ${
            stats.suspiciousStudentsCount > 0
                ? pc.red(pc.bold(stats.suspiciousStudentsCount))
                : pc.green('0')
        }`
    );
    console.log('');
}

/**
 * Prints detected plagiarism clusters to console
 */
export function printPlagiarismClusters(
    clusters: PlagiarismCluster[],
    stats: AnalysisSummaryStats
): void {
    console.log(pc.bold('🚨 KẾT QUẢ PHÁT HIỆN GIAN LẬN / TRÙNG LẶP:'));
    if (clusters.length === 0) {
        console.log(pc.green('✔ Không phát hiện cụm trùng lặp tệp CAD nào nghi vấn.'));
    } else {
        console.log(
            `Tìm thấy ${pc.red(pc.bold(clusters.length))} cụm nghi vấn (` +
                `${pc.red(stats.highSeverityClustersCount + ' Nghiêm trọng')}, ` +
                `${pc.yellow(stats.mediumSeverityClustersCount + ' Trung bình')}, ` +
                `${pc.gray(stats.lowSeverityClustersCount + ' Thấp')})`
        );
        console.log('');

        for (const cluster of clusters) {
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
}

/**
 * Prints summary progress per session to console
 */
export function printSessionSummaries(sessions: Record<string, SessionAnalysisSummary>): void {
    console.log(pc.bold('📅 TỔNG KẾT THEO TỪNG BUỔI HỌC:'));
    for (const [sKey, session] of Object.entries(sessions)) {
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
}

/**
 * Extracts all posts with warnings or criteria violations from sessions
 */
export function extractWarnedPosts(
    sessions: Record<string, SessionAnalysisSummary>
): PostAnalysisResult[] {
    const warnedPosts: PostAnalysisResult[] = [];
    for (const session of Object.values(sessions)) {
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
    return warnedPosts;
}

/**
 * Prints detailed warnings and criteria violations per post
 */
export function printWarnedPosts(sessions: Record<string, SessionAnalysisSummary>): void {
    const warnedPosts = extractWarnedPosts(sessions);
    if (warnedPosts.length === 0) return;

    console.log(
        pc.bold(`⚠️  DANH SÁCH BÀI VIẾT CÓ CẢNH BÁO HOẶC VI PHẠM (${warnedPosts.length} bài):`)
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
            console.log(pc.yellow(`    🔗 Cú pháp   : ${post.urlWarnings.join(', ')}`));
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

/**
 * Renders the full analysis summary report to the terminal console
 */
export function printAnalysisConsoleReport(report: ThreadAnalysisReport): void {
    console.log(pc.green(pc.bold('✔ Phân tích hoàn tất!')));
    console.log(
        pc.gray(`Thời gian thực hiện: ${new Date(report.analyzedAt).toLocaleString('vi-VN')}`)
    );
    console.log('');

    printOverviewStats(report.stats);
    printPlagiarismClusters(report.allClusters, report.stats);
    printSessionSummaries(report.sessions);
    printWarnedPosts(report.sessions);
}
