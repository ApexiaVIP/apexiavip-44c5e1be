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

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your APEXIA VIP password</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.panel}>
          <Text style={styles.brandMark}>APEXIA VIP</Text>
          <Hr style={styles.rule} />
          <Heading style={styles.h1}>Reset your password</Heading>
          <Text style={styles.text}>
            A password reset has been requested for your account. Select the
            option below to choose a new password.
          </Text>
          <Button style={styles.button} href={confirmationUrl}>
            Reset Password
          </Button>
          <Text style={styles.footer}>
            If you did not request this, no action is required &mdash; your
            password will remain unchanged.
          </Text>
          <Text style={styles.legal}>Apexia VIP Ltd &middot; All enquiries confidential</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail
