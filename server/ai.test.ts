import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';

vi.mock('@google/genai', () => ({
    GoogleGenAI: class { },
    Type: { OBJECT: 'object', STRING: 'string' }
}));

vi.mock('node:fs/promises', () => ({
    default: {
        mkdir: vi.fn(),
        writeFile: vi.fn()
    }
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
    });

    describe('generateStoryImage', () => {
        it('should generate an image and save it locally', async () => {
            (ai.models.generateImages as any).mockResolvedValueOnce({
                generatedImages: [ {
                    image: {
                        imageBytes: 'YmFzZTY0dGVzdGk=' // base64 for "base64testi"
                    }
                } ]
            });

            const url = await generateStoryImage('A test image description');

            expect(ai.models.generateImages).toHaveBeenCalledTimes(1);
            expect(url).toMatch(/^\/images\/img_\d+_[a-z0-9]+\.jpg$/);

            expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining(path.join('client', 'public', 'images')), { recursive: true });
            expect(fs.writeFile).toHaveBeenCalledTimes(1);
        });

        it('should return fallback image if no image data is returned', async () => {
            (ai.models.generateImages as any).mockResolvedValueOnce({
                generatedImages: []
            });

            const url = await generateStoryImage('A test image description');
            expect(url).toBe('/images/img_1771936309521_ieycq2.jpg');
        });
    });
});
