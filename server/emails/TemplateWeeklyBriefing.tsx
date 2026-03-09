import * as React from 'react';
import { Html, Head, Preview, Body, Container, Section, Text, Button, Tailwind, Row, Column } from '@react-email/components';

interface SessionInfo {
    id: number;
    title: string;
    description: string;
    formattedDate: string;
}

interface ParamsTemplateWeeklyBriefing {
    sessions: SessionInfo[];
    urlAppBase: string;
}

export default function TemplateWeeklyBriefing({ sessions, urlAppBase }: ParamsTemplateWeeklyBriefing) {
    return (
        <Html>
            <Head />
            <Preview>Your Weekly 25th Chapter Schedule</Preview>
            <Tailwind>
                <Body className="bg-gray-50 font-sans">
                    <Container className="bg-white border border-gray-200 rounded-lg my-[40px] mx-auto p-[32px] max-w-[600px] shadow-sm">
                        <Section className="text-center">
                            <Text className="text-sm font-bold tracking-widest text-gray-400 uppercase m-0">
                                The 25th Chapter
                            </Text>
                            <Text className="text-2xl font-bold text-gray-900 mt-4 mb-8">
                                Your Story Schedule for the Week
                            </Text>
                            <Text className="text-gray-600 text-base leading-relaxed mb-8">
                                Hello reader,<br/><br/>Here is your story schedule for the upcoming week:
                            </Text>
                        </Section>

                        <Section className="mb-8">
                            {sessions.map((session) => (
                                <Row key={session.id} className="mb-4">
                                    <Column className="p-4 border border-gray-100 rounded-lg bg-gray-50 align-top">
                                        <Text className="text-lg font-bold text-gray-900 m-0 mb-1">
                                            {session.title}
                                        </Text>
                                        <Text className="text-sm text-blue-600 font-medium m-0 mb-2">
                                            {session.formattedDate}
                                        </Text>
                                        {session.description && (
                                            <Text className="text-sm text-gray-600 m-0">
                                                {session.description}
                                            </Text>
                                        )}
                                    </Column>
                                </Row>
                            ))}
                        </Section>

                        <Section className="text-center">
                            {/* Primary CTA */}
                            <Button
                                href={urlAppBase}
                                className="bg-black text-white px-8 py-4 rounded-md font-bold block text-center mb-6"
                            >
                                Join the Global Circle
                            </Button>

                            <Text className="text-gray-500 text-sm mt-8">
                                Join the global circle for your daily 25.
                            </Text>
                            <Text className="text-gray-400 text-xs mt-2">
                                - The 25th Chapter Team
                            </Text>
                        </Section>
                    </Container>
                </Body>
            </Tailwind>
        </Html>
    );
}
