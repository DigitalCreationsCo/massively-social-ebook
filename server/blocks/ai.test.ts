import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@google/genai', () => ({
    GoogleGenAI: class { },
    Type: { OBJECT: 'object', STRING: 'string' }
}));

// Mock the RAG module so AI tests remain isolated
vi.mock('./rag', () => ({
    RagProvider: class { },
    buildRAGContext: vi.fn((_channelId: string, immediateContext: string) =>
        Promise.resolve(immediateContext)
    ),
}));

const { mockGenerateContext } = vi.hoisted(() => ({
    mockGenerateContext: vi.fn((_channelId: string, immediateContext: string) =>
        Promise.resolve(immediateContext)
    )
}));

vi.mock('narrative-engine', () => ({
    NarrativeEngine: class {
        generateContext = mockGenerateContext;
    },
    configureLabEngine: vi.fn(),
}));

vi.mock('./storage', () => ({
    storage: {}
}));

import { ai, generateStoryBlock, generateStoryImage } from './ai';

describe('AI Generators', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reassign models mock methods safely
        (ai as any).models = {
            generateContent: vi.fn(),
            generateImages: vi.fn()
        } as any;

        mockGenerateContext.mockImplementation((_channelId: string, immediateContext: string) =>
            Promise.resolve(immediateContext)
        );
    });

    describe('generateStoryBlock', () => {
        it('should generate a valid story block result', async () => {
            (ai.models.generateContent as any).mockResolvedValueOnce({
                text: JSON.stringify({
                    title: 'Test Title',
                    content: 'Test content here.',
                    optionA: { label: 'A', description: 'desc A' },
                    optionB: { label: 'B', description: 'desc B' },
                })
            });

            const result = await generateStoryBlock('scifi', 'Previous block text');

            expect(ai.models.generateContent).toHaveBeenCalledTimes(1);
            expect(result.title).toBe('Test Title');
            expect(result.content).toBe('Test content here.');
            expect(result.optionA?.label).toBe('A');
            expect(result.optionB?.label).toBe('B');
        });

        it('should throw an error if no text is returned', async () => {
            (ai.models.generateContent as any).mockResolvedValueOnce({
                text: undefined
            });

            await expect(generateStoryBlock('scifi', 'Previous context')).rejects.toThrow('Failed to generate story block: No text returned.');
        });

        it('should throw error if empty text is returned', async () => {
            (ai.models.generateContent as any).mockResolvedValueOnce({ text: '' });
            await expect(generateStoryBlock('scifi', 'Context')).rejects.toThrow('Failed to generate story block: No text returned.');
        });

        it('should call NarrativeEngine.generateContext with the channelId and previousContext', async () => {
            (ai.models.generateContent as any).mockResolvedValueOnce({
                text: JSON.stringify({
                    title: 'RAG Title',
                    content: 'RAG content',
                    optionA: { label: 'A', description: 'desc A' },
                    optionB: { label: 'B', description: 'desc B' },
                })
            });

            await generateStoryBlock('mystery', 'The detective investigated.');

            expect(mockGenerateContext).toHaveBeenCalledWith('mystery', 'The detective investigated.');
        });

        it('should use enriched context when NarrativeEngine returns different content', async () => {
            const enrichedContext = 'Story So Far:\n1. It began.\n\nCurrent Situation:\nThe crew arrived.';
            mockGenerateContext.mockResolvedValueOnce(enrichedContext);

            (ai.models.generateContent as any).mockResolvedValueOnce({
                text: JSON.stringify({
                    title: 'Enriched Title',
                    content: 'Enriched content',
                    optionA: { label: 'A', description: 'desc A' },
                    optionB: { label: 'B', description: 'desc B' },
                })
            });

            const result = await generateStoryBlock('scifi', 'The crew arrived.');

            expect(result.title).toBe('Enriched Title');
            // The prompt should have included ragContext since enrichedContext !== previousContext
            const calledPrompt = (ai.models.generateContent as any).mock.calls[ 0 ][ 0 ].contents;
            expect(calledPrompt).toContain('Story So Far');
        });

        it('should remove options when isResolution is true', async () => {
            (ai.models.generateContent as any).mockResolvedValueOnce({
                text: JSON.stringify({
                    title: 'Resolution Title',
                    content: 'Resolution content.',
                    optionA: { label: 'A', description: 'desc A' },
                    optionB: { label: 'B', description: 'desc B' },
                })
            });

            const result = await generateStoryBlock('scifi', 'Previous', true);

            expect(result.optionA).toBeUndefined();
            expect(result.optionB).toBeUndefined();
            expect(result.title).toBe('Resolution Title');
        });
    });

    describe('generateStoryImage', () => {
        it('should generate an image and return raw base64 (no data URI prefix)', async () => {
            const base64Image = 'YmFzZTY0dGVzdGk='; // base64 for "base64testi"

            (ai.models.generateContent as any).mockResolvedValueOnce({
                candidates: [ {
                    content: {
                        parts: [ {
                            inlineData: {
                                data: base64Image
                            }
                        } ]
                    }
                } ]
            });

            const result = await generateStoryImage('A test image description');

            expect(ai.models.generateContent).toHaveBeenCalledTimes(1);
            expect(ai.models.generateContent).toHaveBeenCalledWith({
                model: 'gemini-2.5-flash-image',
                contents: expect.any(String),
                config: {
                    responseModalities: [ "image" ],
                    candidateCount: 1,
                    imageConfig: {
                        aspectRatio: "16:9",
                    }
                }
            });
            // Returns RAW base64 — NOT a data: URI.  The caller is responsible
            // for uploading to object storage.
            expect(result).toBe(base64Image);
            expect(result).not.toContain('data:image');
        });

        it('should throw if no image data is returned from Gemini', async () => {
            (ai.models.generateContent as any).mockResolvedValueOnce({
                candidates: [ {
                    content: {
                        parts: []
                    }
                } ]
            });

            await expect(
                generateStoryImage('A test image description'),
            ).rejects.toThrow('No image data returned from Gemini.');
        });

        it('should throw if candidates is undefined', async () => {
            (ai.models.generateContent as any).mockResolvedValueOnce({});

            await expect(
                generateStoryImage('A test image description'),
            ).rejects.toThrow('No image data returned from Gemini.');
        });

        it('should throw if content is undefined', async () => {
            (ai.models.generateContent as any).mockResolvedValueOnce({
                candidates: [ {} ]
            });

            await expect(
                generateStoryImage('A test image description'),
            ).rejects.toThrow('No image data returned from Gemini.');
        });

        it('should propagate API errors (no silent fallback)', async () => {
            (ai.models.generateContent as any).mockRejectedValueOnce(new Error('API Error'));

            await expect(
                generateStoryImage('A test image description'),
            ).rejects.toThrow('API Error');
        });
    });
});
