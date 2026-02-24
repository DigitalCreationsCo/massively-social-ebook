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

import { ai, generateStoryBlock, generateStoryImage } from './ai';

describe('AI Generators', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reassign models mock methods safely
        ai.models = {
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

            expect(fs.mkdir).toHaveBeenCalledTimes(1);
            expect(fs.writeFile).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if no image data is returned', async () => {
            (ai.models.generateImages as any).mockResolvedValueOnce({
                generatedImages: []
            });

            await expect(generateStoryImage('A test image description')).rejects.toThrow('Failed to generate image: No image data returned.');
        });
    });
});
