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

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your APEXIA VIP access link</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.panel}>
          <Text style={styles.brandMark}>APEXIA VIP</Text>
          <Hr style={styles.rule} />
          <Heading style={styles.h1}>Your access link</Heading>
          <Text style={styles.text}>
            Select the option below to sign in. This link will expire shortly.
          </Text>
          <Button style={styles.button} href={confirmationUrl}>
            Sign In
          </Button>
          <Text style={styles.footer}>
            If this was not requested, this message may be disregarded.
          </Text>
          <Text style={styles.legal}>Apexia VIP Ltd &middot; All enquiries confidential</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail
