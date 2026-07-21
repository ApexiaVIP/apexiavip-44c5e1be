/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

import { styles } from './_brand.ts'

interface EmailChangeEmailProps {
  siteName: string
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your APEXIA VIP email change</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.panel}>
          <Text style={styles.brandMark}>APEXIA VIP</Text>
          <Hr style={styles.rule} />
          <Heading style={styles.h1}>Confirm email change</Heading>
          <Text style={styles.text}>
            A request was made to change your email from{' '}
            <span style={styles.link}>{oldEmail}</span> to{' '}
            <span style={styles.link}>{newEmail}</span>.
          </Text>
          <Button style={styles.button} href={confirmationUrl}>
            Confirm Change
          </Button>
          <Text style={styles.footer}>
            If you did not request this, please secure your account immediately.
          </Text>
          <Text style={styles.legal}>Apexia VIP Ltd &middot; All enquiries confidential</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail
