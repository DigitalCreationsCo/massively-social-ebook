import * as React from 'react';
import { Html, Head, Preview, Body, Container, Section, Text, Button, Tailwind, Row, Column } from '@react-email/components';
import { type Session } from "@shared/schema";

interface ParamsTemplateCalendarInvite {
    dataSession: Session;
    urlAppBase: string;
    calendarLinks: {
        google: string;
        outlook: string;
        office365: string;
    };
};

export default function TemplateCalendarInvite({ dataSession, urlAppBase, calendarLinks }: ParamsTemplateCalendarInvite) {
    return (
        <Html>
            <Head />
            <Preview>Add to Calendar: {dataSession.title}</Preview>
            <Tailwind>
                <Body className="bg-gray-50 font-sans">
                    <Container className="bg-white border border-gray-200 rounded-lg my-[40px] mx-auto p-[32px] max-w-[600px] shadow-sm">
                        <Section className="text-center">
                            <Text className="text-sm font-bold tracking-widest text-gray-400 uppercase m-0">
                                The 25th Chapter
                            </Text>
                            <Text className="text-2xl font-bold text-gray-900 mt-4 mb-2">
                                {dataSession.title}
                            </Text>
                            <Text className="text-gray-600 text-base leading-relaxed mb-8">
                                {dataSession.description}
                            </Text>

                            {/* Primary CTA */}
                            <Button
                                href={urlAppBase}
                                className="bg-black text-white px-8 py-4 rounded-md font-bold block text-center mb-10"
                            >
                                Join the Story Live
                            </Button>

                            <Text className="text-xs font-semibold text-gray-400 uppercase tracking-tight mb-4">
                                Add to your calendar
                            </Text>

                            {/* Secondary Calendar Links */}
                            <Row>
                                <Column align="center">
                                    <Button href={calendarLinks.google} className="text-blue-600 text-sm font-medium px-2">Google</Button>
                                    <Text className="inline-block text-gray-300">|</Text>
                                    <Button href={calendarLinks.outlook} className="text-blue-600 text-sm font-medium px-2">Outlook</Button>
                                    <Text className="inline-block text-gray-300">|</Text>
                                    <Button href={calendarLinks.office365} className="text-blue-600 text-sm font-medium px-2">Office 365</Button>
                                </Column>
                            </Row>
                            <Text className="text-gray-400 text-[10px] mt-4">
                                (An .ics file is also attached for Apple Calendar users)
                            </Text>
                        </Section>
                    </Container>
                </Body>
            </Tailwind>
        </Html>
    );
}