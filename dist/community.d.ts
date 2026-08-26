import { Hono } from 'hono';
export interface CommunityServerOptions {
    storage?: CommunityStorage;
    maxSb3Bytes?: number;
    maxImageBytes?: number;
    oauthProviders?: Record<string, OAuthProviderConfig | undefined>;
}
export interface OAuthProviderConfig {
    clientId: string;
    authorizationUrl: string;
    redirectUri?: string;
    scope?: string;
}
export interface CommunityUser {
    id: string;
    username: string;
    passwordHash?: string;
    oauthProvider?: string;
    oauthSubject?: string;
    createdAt: string;
}
export interface CommunityProject {
    id: string;
    ownerId: string;
    title: string;
    description: string;
    sb3Bytes: Uint8Array;
    sb3FileName: string;
    sb3MimeType: string;
    thumbnailBytes?: Uint8Array;
    thumbnailFileName?: string;
    thumbnailMimeType?: string;
    remixOfProjectId?: string;
    createdAt: string;
    updatedAt: string;
}
export interface CommunitySession {
    id: string;
    csrfToken: string;
    userId?: string;
    oauthState?: string | undefined;
    oauthProvider?: string | undefined;
    expiresAt: number;
}
export interface CommunityStorage {
    createUser(input: Omit<CommunityUser, 'id' | 'createdAt'>): Promise<CommunityUser>;
    findUserByUsername(username: string): Promise<CommunityUser | null>;
    findUserById(id: string): Promise<CommunityUser | null>;
    findUserByOAuth(provider: string, subject: string): Promise<CommunityUser | null>;
    createSession(input: Pick<CommunitySession, 'csrfToken' | 'expiresAt'>): Promise<CommunitySession>;
    getSession(id: string): Promise<CommunitySession | null>;
    saveSession(session: CommunitySession): Promise<void>;
    deleteSession(id: string): Promise<void>;
    createProject(input: Omit<CommunityProject, 'id' | 'createdAt' | 'updatedAt'>): Promise<CommunityProject>;
    findProjectById(id: string): Promise<CommunityProject | null>;
    listProjects(): Promise<readonly CommunityProject[]>;
    saveProject(project: CommunityProject): Promise<void>;
    deleteProject(id: string): Promise<boolean>;
}
export declare function createCommunityApp(options?: CommunityServerOptions): Hono;
export declare class InMemoryCommunityStorage implements CommunityStorage {
    private userSequence;
    private projectSequence;
    private readonly users;
    private readonly sessions;
    private readonly projects;
    createUser(input: Omit<CommunityUser, 'id' | 'createdAt'>): Promise<CommunityUser>;
    findUserByUsername(username: string): Promise<CommunityUser | null>;
    findUserById(id: string): Promise<CommunityUser | null>;
    findUserByOAuth(provider: string, subject: string): Promise<CommunityUser | null>;
    createSession(input: Pick<CommunitySession, 'csrfToken' | 'expiresAt'>): Promise<CommunitySession>;
    getSession(id: string): Promise<CommunitySession | null>;
    saveSession(session: CommunitySession): Promise<void>;
    deleteSession(id: string): Promise<void>;
    createProject(input: Omit<CommunityProject, 'id' | 'createdAt' | 'updatedAt'>): Promise<CommunityProject>;
    findProjectById(id: string): Promise<CommunityProject | null>;
    listProjects(): Promise<readonly CommunityProject[]>;
    saveProject(project: CommunityProject): Promise<void>;
    deleteProject(id: string): Promise<boolean>;
}
export declare function readOAuthProvidersFromEnv(env: NodeJS.ProcessEnv): Record<string, OAuthProviderConfig>;
