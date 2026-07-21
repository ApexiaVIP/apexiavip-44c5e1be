/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
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

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your APEXIA VIP verification code</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.panel}>
          <Text style={styles.brandMark}>APEXIA VIP</Text>
          <Hr style={styles.rule} />
          <Heading style={styles.h1}>Verification code</Heading>
          <Text style={styles.text}>
            Enter the code below to confirm your identity.
          </Text>
          <Text style={styles.code}>{token}</Text>
          <Text style={styles.footer}>
            This code will expire shortly. If you did not request it, this
            message may be disregarded.
          </Text>
          <Text style={styles.legal}>Apexia VIP Ltd &middot; All enquiries confidential</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail
