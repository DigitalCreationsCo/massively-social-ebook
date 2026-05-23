import { BlockWithChats } from "@/hooks/use-session-replay";
import { Session, ChatMessage } from "@shared/schema";
import {
    AbsoluteFill,
    Img,
    interpolate,
    Sequence,
    useCurrentFrame,
} from "remotion";

interface ReplayProps {
    blocks: BlockWithChats[];
    session?: Session;
}

// type ChatMessage = {
//     sender: string;
//     text: string;
//     appearAt: number;
// };

// type Story = {
//     image: string;
//     title: string;
//     subtitle?: string;
//     durationInFrames: number;
//     chatMessages?: ChatMessage[];
// };

// const stories: Story[] = [
//     {
//         image: "/story1.jpg",
//         title: "The signal appeared",
//         subtitle: "Nobody knew why",
//         durationInFrames: 180,
//         chatMessages: [
//             { sender: "Ava", text: "Did you see that?", appearAt: 30 },
//             { sender: "Jon", text: "Everything just cut out.", appearAt: 60 },
//             { sender: "Ava", text: "I’m losing service…", appearAt: 110 },
//         ],
//     },
//     {
//         image: "/story2.jpg",
//         title: "Then the city went dark",
//         subtitle: "Phones stopped working",
//         durationInFrames: 180,
//         chatMessages: [
//             { sender: "System", text: "No signal detected", appearAt: 20 },
//             { sender: "Jon", text: "This isn’t normal.", appearAt: 80 },
//         ],
//     },
// ];

function ChatBubble({
    msg,
    index,
    blockIndex,
    frame,
}: {
    msg: ChatMessage;
    index: number;
    blockIndex: number;
    frame: number;
}) {
    const localFrame = frame;

    const visible = localFrame >= 0;

    const opacity = interpolate(localFrame, [ 0, 10 ], [ 0, 1 ], {
        extrapolateLeft: "clamp",
    });

    const translateY = interpolate(localFrame, [ 0, 10 ], [ 20, 0 ], {
        extrapolateLeft: "clamp",
    });

    if (!visible) return null;

    return (
        <div
            style={ {
                marginBottom: 14,
                opacity,
                transform: `translateY(${translateY}px)`,
                background: "rgba(0,0,0,0.55)",
                padding: "14px 18px",
                borderRadius: 18,
                color: "white",
                maxWidth: 520,
                backdropFilter: "blur(8px)",
            } }
        >
            <div style={ { fontSize: 18, fontWeight: 600, opacity: 0.8 } }>
                { msg.username }
            </div>
            <div style={ { fontSize: 22 } }>{ msg.text }</div>
        </div>
    );
}

function StoryScene({ story, blockIndex }: { story: BlockWithChats; blockIndex: number; }) {
    const frame = useCurrentFrame();

    const scale = interpolate(frame, [ 0, 180 ], [ 1, 1.1 ]);

    return (
        <AbsoluteFill>
            <Img
                src={ story.imageUrl || "" }
                style={ {
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: `scale(${scale})`,
                } }
            />

            {/* overlay */ }
            <AbsoluteFill
                style={ {
                    background:
                        "linear-gradient(to top, rgba(0,0,0,0.75), transparent 60%)",
                } }
            />

            {/* text */ }
            <div
                style={ {
                    position: "absolute",
                    bottom: 360,
                    left: 80,
                    right: 80,
                    color: "white",
                } }
            >
                <h1 style={ { fontSize: 72, fontWeight: 700 } }>
                    { story.title }
                </h1>
                { story.content && (
                    <p style={ { fontSize: 36, opacity: 0.85 } }>
                        { story.content }
                    </p>
                ) }
            </div>

            {/* chat overlay */ }
            <div
                style={ {
                    position: "absolute",
                    bottom: 80,
                    left: 80,
                    display: "flex",
                    flexDirection: "column",
                } }
            >
                { story.chats?.map((msg, i) => (
                    <ChatBubble
                        key={ i }
                        msg={ msg }
                        index={ i }
                        blockIndex={ blockIndex }
                        frame={ frame }
                    />
                )) }
            </div>
        </AbsoluteFill>
    );
}

export const Replay = ({ blocks, session }: ReplayProps) => {
    let cursor = 0;

    return (
        <AbsoluteFill>
            { blocks.map((block, blockIndex) => {
                const start = cursor;
                cursor += Math.random() * 10;

                return (
                    <Sequence
                        key={ blockIndex }
                        from={ start }
                        durationInFrames={ cursor }
                    >
                        <StoryScene
                            story={ block }
                            blockIndex={ blockIndex }
                        />
                    </Sequence>
                );
            }) }
        </AbsoluteFill>
    );
};