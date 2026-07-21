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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({ confirmationUrl }: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your APEXIA VIP membership</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.panel}>
          <Text style={styles.brandMark}>APEXIA VIP</Text>
          <Hr style={styles.rule} />
          <Heading style={styles.h1}>Confirm your membership</Heading>
          <Text style={styles.text}>
            Please confirm your email address to activate your access.
          </Text>
          <Button style={styles.button} href={confirmationUrl}>
            Confirm Access
          </Button>
          <Text style={styles.footer}>
            If you did not request this, you may disregard this message.
          </Text>
          <Text style={styles.legal}>Apexia VIP Ltd &middot; All enquiries confidential</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail
