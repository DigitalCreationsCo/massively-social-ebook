import * as React from 'react';
import { Html, Head, Preview, Body, Container, Section, Text, Button, Tailwind } from '@react-email/components';
import { type Session } from "@shared/schema";

interface ParamsTemplateCalendarInvite {
    dataSession: Session;
    urlAppBase: string;
}

export default function TemplateCalendarInvite({ dataSession, urlAppBase }: ParamsTemplateCalendarInvite) {
    return (
        <Html>
            <Head />
            <Preview>You are invited to join the story session: { dataSession.title }</Preview>
            <Tailwind>
                <Body className="bg-gray-50 font-sans">
                    <Container className="bg-white border border-gray-200 rounded-lg my-[40px] mx-auto p-[32px] max-w-[600px] shadow-sm">
                        <Section className="text-center">
                            <Text className="text-sm font-bold tracking-widest text-gray-400 uppercase m-0">
                                The 25th Chapter
                            </Text>
                            <Text className="text-2xl font-bold text-gray-900 mt-4 mb-2">
                                { dataSession.title }
                            </Text>
                            <Text className="text-gray-600 text-base leading-relaxed mb-8">
                                { dataSession.description }
                            </Text>
                            <Button
                                href={ urlAppBase }
                                className="bg-black text-white px-6 py-3 rounded-md font-medium block text-center"
                            >
                                Join the Story Live
                            </Button>
                        </Section>
                    </Container>
                </Body>
            </Tailwind>
        </Html>
    );
}