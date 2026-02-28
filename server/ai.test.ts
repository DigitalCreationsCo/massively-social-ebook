import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@google/genai', () => ({
    GoogleGenAI: class { },
    Type: { OBJECT: 'object', STRING: 'string' }
}));

// Mock the RAG module so AI tests remain isolated
vi.mock('./rag', () => ({
    buildRAGContext: vi.fn((_channelId: string, immediateContext: string) =>
        Promise.resolve(immediateContext)
    ),
}));

import { ai, generateStoryBlock, generateStoryImage } from './ai';
import { buildRAGContext } from './rag';

describe('AI Generators', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reassign models mock methods safely
        (ai as any).models = {
            generateContent: vi.fn(),
            generateImages: vi.fn()
        } as any;
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
            expect(result.optionA.label).toBe('A');
            expect(result.optionB.label).toBe('B');
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

        it('should call buildRAGContext with the channelId and previousContext', async () => {
            (ai.models.generateContent as any).mockResolvedValueOnce({
                text: JSON.stringify({
                    title: 'RAG Title',
                    content: 'RAG content',
                    optionA: { label: 'A', description: 'desc A' },
                    optionB: { label: 'B', description: 'desc B' },
                })
            });

            await generateStoryBlock('mystery', 'The detective investigated.');

            expect(buildRAGContext).toHaveBeenCalledWith('mystery', 'The detective investigated.');
        });

        it('should use enriched context when RAG returns different content', async () => {
            const enrichedContext = 'Story So Far:\n1. It began.\n\nCurrent Situation:\nThe crew arrived.';
            (buildRAGContext as any).mockResolvedValueOnce(enrichedContext);

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
        it('should generate an image and return data URL', async () => {
            const base64Image = 'YmFzZTY0dGVzdGk='; // base64 for "base64testi"
            
            (ai.models.generateContent as any).mockResolvedValueOnce({
                candidates: [{
                    content: {
                        parts: [{
                            inlineData: {
                                data: base64Image
                            }
                        }]
                    }
                }]
            });

            const result = await generateStoryImage('A test image description');

            expect(ai.models.generateContent).toHaveBeenCalledTimes(1);
            expect(ai.models.generateContent).toHaveBeenCalledWith({
                model: 'gemini-2.5-flash-image',
                contents: expect.any(String),
                config: {
                    responseModalities: ["image"],
                    candidateCount: 1,
                    imageConfig: {
                        aspectRatio: "16:9",
                    }
                }
            });
            expect(result).toBe(`data:image/jpeg;base64,${base64Image}`);
        });

        it('should return fallback image if no image data is returned', async () => {
            (ai.models.generateContent as any).mockResolvedValueOnce({
                candidates: [{
                    content: {
                        parts: []
                    }
                }]
            });

            const url = await generateStoryImage('A test image description');
            expect(url).toBe('/images/img_1771936309521_ieycq2.jpg');
        });

        it('should return fallback image if candidates is undefined', async () => {
            (ai.models.generateContent as any).mockResolvedValueOnce({});

            const url = await generateStoryImage('A test image description');
            expect(url).toBe('/images/img_1771936309521_ieycq2.jpg');
        });

        it('should return fallback image if content is undefined', async () => {
            (ai.models.generateContent as any).mockResolvedValueOnce({
                candidates: [{}]
            });

            const url = await generateStoryImage('A test image description');
            expect(url).toBe('/images/img_1771936309521_ieycq2.jpg');
        });

        it('should return fallback image on API error', async () => {
            (ai.models.generateContent as any).mockRejectedValueOnce(new Error('API Error'));

            const url = await generateStoryImage('A test image description');
            expect(url).toBe('/images/img_1771936309521_ieycq2.jpg');
        });

        it('should log warning on fallback', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            
            (ai.models.generateContent as any).mockRejectedValueOnce(new Error('API Error'));

            await generateStoryImage('A test image description');

            expect(consoleWarnSpy).toHaveBeenCalledWith(
                'Failed to generate image, using fallback:',
                expect.any(Error)
            );
            
            consoleWarnSpy.mockRestore();
        });
    });
});
