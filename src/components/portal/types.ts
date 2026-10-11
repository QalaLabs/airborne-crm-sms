// Shared types for the Student Portal UI

export interface ContinueLearning {
  courseId: string;
  courseTitle: string;
  percentComplete: number;
}

export interface MeEnrollment {
  id: string;
  courseId: string;
  percentComplete: number;
  course: { id: string; title: string; slug: string; isPublished: boolean };
}

export interface MeAssessment {
  moduleId: string;
  status: string;
  score: number;
  attempts: number;
  module: {
    id: string;
    title: string;
    maxAttempts: number;
    passPercent: number;
    stage: { courseId: string };
  };
}

export interface MeCertificate {
  id: string;
  title: string;
  certificateNo: string;
  verificationCode?: string | null;
  issuedAt?: string | null;
  fileUrl?: string | null;
  status: string;
  course?: { title: string };
}

export interface MeAttendanceRecord {
  id: string;
  status: string;
  markedAt?: string;
  session?: { title: string; heldAt: string; courseId: string };
}

export interface MeAnnouncement {
  id: string;
  title: string;
  body: string;
  publishedAt: string | null;
  courseId?: string | null;
}

export interface MeBookmark {
  id: string;
  topic: { id: string; title: string };
}

export interface MeQuizAttempt {
  moduleId: string;
  score: number;
  passed: boolean;
  createdAt: string;
}

export interface MeProgress {
  topicId: string;
  completed: boolean;
  percent: number;
  updatedAt?: string;
}

export interface MeStudent {
  id: string;
  firstName: string;
  lastName: string;
  studentCode: string;
  email?: string;
}

export interface MeUser {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
  phone?: string | null;
}

export interface MePayload {
  student: MeStudent;
  user: MeUser;
  enrollments: MeEnrollment[];
  progress: MeProgress[];
  assessments: MeAssessment[];
  certificates: MeCertificate[];
  attendance: MeAttendanceRecord[];
  attendancePercent: number;
  completedTopics: number;
  announcements: MeAnnouncement[];
  bookmarks: MeBookmark[];
  quizAttempts: MeQuizAttempt[];
  continueLearning: ContinueLearning | null;
}

// Course Player types
export interface PlayerContent {
  id: string;
  title: string;
  type: "PDF" | "VIDEO" | "NOTES";
  url: string;
  duration?: number | null;
}

export interface PlayerTopic {
  id: string;
  title: string;
  contents: PlayerContent[];
}

export interface PlayerChapter {
  id: string;
  title: string;
  topics: PlayerTopic[];
}

export interface PlayerModule {
  id: string;
  title: string;
  passPercent: number;
  maxAttempts: number;
  chapters: PlayerChapter[];
}

export interface PlayerStage {
  id: string;
  title: string;
  modules: PlayerModule[];
}

export interface PlayerPayload {
  course: { id: string; title: string; stages: PlayerStage[] };
  progress: Array<{ topicId: string; completed: boolean; percent: number }>;
  assessments: Array<{ moduleId: string; status: string; score: number; attempts: number }>;
  unlockedModuleIds: string[];
  bookmarkedTopicIds: string[];
  quizAttempts: Array<{ moduleId: string; score: number; passed: boolean; attemptNumber: number; createdAt: string }>;
}

export interface FlatTopic {
  topicId: string;
  topicTitle: string;
  moduleId: string;
  moduleTitle: string;
  chapterId: string;
  chapterTitle: string;
  stageTitle: string;
  locked: boolean;
  contents: PlayerContent[];
}
