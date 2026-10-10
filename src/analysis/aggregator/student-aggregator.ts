/**
 * Student Aggregator
 * Aggregates submission records, timeliness, criteria compliance,
 * and plagiarism involvement per student.
 */
import type { PostAnalysisResult, StudentAnalysisSummary } from '../types/index.js';

/**
 * Aggregates post results into per-student summaries
 */
export function aggregateStudentSummaries(
    postResults: PostAnalysisResult[]
): Record<string, StudentAnalysisSummary> {
    const students: Record<string, StudentAnalysisSummary> = {};

    for (const post of postResults) {
        const uid = post.author.uid;
        if (!students[uid]) {
            students[uid] = {
                uid,
                username: post.author.username,
                userFolder: post.userFolder,
                totalSubmissions: 0,
                submittedSessions: [],
                missingSessions: [],
                lateSubmissionsCount: 0,
                criteriaFailedCount: 0,
                plagiarismInvolvementCount: 0,
                involvedClusterIds: [],
            };
        }

        const student = students[uid];
        student.totalSubmissions++;
        if (
            post.sessionIndex !== undefined &&
            !student.submittedSessions.includes(post.sessionIndex)
        ) {
            student.submittedSessions.push(post.sessionIndex);
            student.submittedSessions.sort((a, b) => a - b);
        }
        if (post.isLate) student.lateSubmissionsCount++;
        if (!post.passedCriteria) student.criteriaFailedCount++;

        for (const cid of post.involvedClusterIds) {
            if (!student.involvedClusterIds.includes(cid)) {
                student.involvedClusterIds.push(cid);
                student.plagiarismInvolvementCount++;
            }
        }
    }

    return students;
}
