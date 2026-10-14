-- Apexia VIP: public schema baseline
--
-- Built by replaying every file in supabase/migrations into a clean Postgres 15
-- and dumping the result, so it is the same shape the live database has.
-- Purpose: stand up a brand new database in one step instead of replaying 56 files.
-- It does not replace the migration history and it never runs against the live site.
--
-- Order on a fresh project: 1) platform.sql  2) this file  3) grants.sql
--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;  -- already present on a new Supabase project


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'member'
);


--
-- Name: cleanup_old_rate_limits(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_rate_limits() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM public.rate_limits WHERE created_at < now() - interval '1 hour';
  RETURN NEW;
END;
$$;


--
-- Name: delete_email(text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_email(queue_name text, message_id bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$$;


--
-- Name: desk_group_allowed(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.desk_group_allowed(_user_id uuid, _grp text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p.corporate_groups IS NULL OR _grp = ANY (p.corporate_groups)
  FROM public.profiles p
  WHERE p.id = _user_id
$$;


--
-- Name: enqueue_email(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_email(queue_name text, payload jsonb) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;


--
-- Name: is_family_member_of(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_family_member_of(_member uuid, _primary uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _member AND primary_member_id = _primary
  );
$$;


--
-- Name: move_to_dlq(text, text, bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$$;


--
-- Name: protect_profile_columns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_profile_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.id := OLD.id;
    NEW.phone := OLD.phone;
    NEW.status := OLD.status;
    NEW.primary_member_id := OLD.primary_member_id;
    NEW.invited_by := OLD.invited_by;
    NEW.created_at := OLD.created_at;
    NEW.corporate := OLD.corporate;
    NEW.corporate_groups := OLD.corporate_groups;
    NEW.is_driver := OLD.is_driver;
    NEW.app_platform := OLD.app_platform;
    NEW.app_last_seen_at := OLD.app_last_seen_at;
    NEW.app_nudged_at := OLD.app_nudged_at;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: read_email_batch(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer) RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: booking_waypoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_waypoints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_reference text NOT NULL,
    driver_id uuid NOT NULL,
    kind text NOT NULL,
    place text DEFAULT ''::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    lat double precision,
    lng double precision,
    CONSTRAINT booking_waypoints_kind_check CHECK ((kind = ANY (ARRAY['en_route'::text, 'arrived'::text, 'pob'::text, 'waiting'::text, 'clear'::text, 'set_down'::text, 'collected'::text, 'note'::text])))
);


--
-- Name: TABLE booking_waypoints; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_waypoints IS 'Stops within a job, chiefly as-directed set downs and collections, which Dispatch cannot record';


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    travel_date text NOT NULL,
    vehicle text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    passengers integer DEFAULT 1,
    bags integer DEFAULT 0,
    user_id uuid,
    reference text,
    assigned_booking_id integer,
    assigned_reference text,
    collection_at timestamp with time zone,
    pickup jsonb,
    dropoff jsonb,
    status text DEFAULT 'Requested'::text NOT NULL,
    status_checked_at timestamp with time zone,
    journey_type text DEFAULT 'destination'::text NOT NULL,
    as_directed_hours integer,
    via jsonb,
    corporate text,
    stops jsonb,
    notified_status text,
    notes text,
    children jsonb,
    booking_type text DEFAULT 'personal'::text NOT NULL,
    business jsonb,
    client_car jsonb,
    return_of text,
    subject_to_availability boolean DEFAULT false NOT NULL,
    declined_reason text,
    driver_id uuid,
    driver_name text,
    driver_status text,
    driver_status_at timestamp with time zone,
    driver_moment text,
    driver_lat double precision,
    driver_lng double precision,
    driver_position_at timestamp with time zone,
    job_report_sent_at timestamp with time zone,
    CONSTRAINT bookings_booking_type_check CHECK ((booking_type = ANY (ARRAY['personal'::text, 'business'::text]))),
    CONSTRAINT bookings_driver_status_check CHECK (((driver_status IS NULL) OR (driver_status = ANY (ARRAY['en_route'::text, 'arrived'::text, 'pob'::text, 'waiting'::text, 'clear'::text])))),
    CONSTRAINT bookings_journey_type_check CHECK ((journey_type = ANY (ARRAY['destination'::text, 'hourly'::text])))
);


--
-- Name: COLUMN bookings.return_of; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.return_of IS 'Reference of the outbound booking this is the return leg of; null for a one-way or outbound booking';


--
-- Name: COLUMN bookings.subject_to_availability; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.subject_to_availability IS 'Taken but not promised: booked within two hours of pickup, or a pickup between midnight and 6am';


--
-- Name: COLUMN bookings.declined_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.declined_reason IS 'Why the office could not cover the journey; shown to nobody but kept for the record';


--
-- Name: COLUMN bookings.driver_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.driver_status IS 'Where the chauffeur has got to, from their own app. Dispatch is not updated by it.';


--
-- Name: COLUMN bookings.driver_position_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.driver_position_at IS 'When our own app last reported the chauffeur position. Cleared when the job is cleared.';


--
-- Name: bookings_backup_20260818; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings_backup_20260818 (
    id uuid,
    name text,
    email text,
    phone text,
    travel_date text,
    vehicle text,
    created_at timestamp with time zone,
    passengers integer,
    bags integer,
    user_id uuid,
    reference text,
    assigned_booking_id integer,
    assigned_reference text,
    collection_at timestamp with time zone,
    pickup jsonb,
    dropoff jsonb,
    status text,
    status_checked_at timestamp with time zone,
    journey_type text,
    as_directed_hours integer,
    via jsonb,
    corporate text,
    stops jsonb
);


--
-- Name: corporate_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    corporate text NOT NULL,
    label text NOT NULL,
    address text NOT NULL,
    passenger_id uuid,
    grey_tarmac boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: corporate_passengers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_passengers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    corporate text NOT NULL,
    name text NOT NULL,
    grp text NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    notify_sms boolean DEFAULT false NOT NULL,
    notify_email boolean DEFAULT false NOT NULL,
    notify_target text DEFAULT 'passenger'::text NOT NULL,
    is_group boolean DEFAULT false NOT NULL,
    CONSTRAINT corporate_passengers_notify_target_check CHECK ((notify_target = ANY (ARRAY['passenger'::text, 'booker'::text])))
);


--
-- Name: driver_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_send_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_send_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id text,
    template_name text NOT NULL,
    recipient_email text NOT NULL,
    status text NOT NULL,
    error_message text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_send_log_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'suppressed'::text, 'failed'::text, 'bounced'::text, 'complained'::text, 'dlq'::text])))
);


--
-- Name: email_send_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_send_state (
    id integer DEFAULT 1 NOT NULL,
    retry_after_until timestamp with time zone,
    batch_size integer DEFAULT 10 NOT NULL,
    send_delay_ms integer DEFAULT 200 NOT NULL,
    auth_email_ttl_minutes integer DEFAULT 15 NOT NULL,
    transactional_email_ttl_minutes integer DEFAULT 60 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_send_state_id_check CHECK ((id = 1))
);


--
-- Name: email_unsubscribe_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_unsubscribe_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: fixture_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixture_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fixture_id uuid NOT NULL,
    corporate text NOT NULL,
    field text NOT NULL,
    old_value text DEFAULT ''::text NOT NULL,
    new_value text DEFAULT ''::text NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fixtures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixtures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    corporate text NOT NULL,
    club text NOT NULL,
    competition text DEFAULT 'Premier League'::text NOT NULL,
    season text NOT NULL,
    match_number integer NOT NULL,
    round_number integer,
    kickoff_utc timestamp with time zone NOT NULL,
    home_team text NOT NULL,
    away_team text NOT NULL,
    opponent text NOT NULL,
    is_home boolean NOT NULL,
    venue text DEFAULT ''::text NOT NULL,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: membership_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    address_line1 text DEFAULT ''::text NOT NULL,
    address_line2 text DEFAULT ''::text NOT NULL,
    town text DEFAULT ''::text NOT NULL,
    postcode text DEFAULT ''::text NOT NULL,
    country text DEFAULT 'United Kingdom'::text NOT NULL,
    heard_from text DEFAULT ''::text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    handled_by uuid,
    handled_at timestamp with time zone,
    notes text,
    CONSTRAINT membership_applications_status_check CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'accepted'::text, 'declined'::text])))
);


--
-- Name: TABLE membership_applications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.membership_applications IS 'Enquiries from the public asking to become members; the office contacts them to set up an account';


--
-- Name: mfa_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mfa_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    code_hash text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mfa_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mfa_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_id text NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text DEFAULT ''::text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    address_line1 text DEFAULT ''::text NOT NULL,
    address_line2 text DEFAULT ''::text NOT NULL,
    town text DEFAULT ''::text NOT NULL,
    postcode text DEFAULT ''::text NOT NULL,
    country text DEFAULT 'United Kingdom'::text NOT NULL,
    avatar_url text DEFAULT ''::text NOT NULL,
    profile_completed boolean DEFAULT false NOT NULL,
    primary_member_id uuid,
    corporate text,
    corporate_groups text[],
    app_platform text,
    app_last_seen_at timestamp with time zone,
    app_nudged_at timestamp with time zone,
    business_defaults jsonb,
    is_driver boolean DEFAULT false NOT NULL,
    CONSTRAINT profiles_app_platform_check CHECK (((app_platform IS NULL) OR (app_platform = ANY (ARRAY['ios'::text, 'android'::text])))),
    CONSTRAINT profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text, 'pending'::text])))
);


--
-- Name: COLUMN profiles.business_defaults; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.business_defaults IS 'Last business details used on a booking: company, department, clients, pa_name, pa_contact, invoice_address';


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ip_address text NOT NULL,
    endpoint text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: suppressed_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppressed_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    reason text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT suppressed_emails_reason_check CHECK ((reason = ANY (ARRAY['unsubscribe'::text, 'bounce'::text, 'complaint'::text])))
);


--
-- Name: timesheet_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timesheet_runs (
    day date NOT NULL,
    kind text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE timesheet_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.timesheet_runs IS 'One row per summary sent, so a wrap up that waits for the last chauffeur still only goes once';


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: booking_waypoints booking_waypoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_waypoints
    ADD CONSTRAINT booking_waypoints_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_reference_key UNIQUE (reference);


--
-- Name: corporate_addresses corporate_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_addresses
    ADD CONSTRAINT corporate_addresses_pkey PRIMARY KEY (id);


--
-- Name: corporate_passengers corporate_passengers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_passengers
    ADD CONSTRAINT corporate_passengers_pkey PRIMARY KEY (id);


--
-- Name: driver_shifts driver_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_shifts
    ADD CONSTRAINT driver_shifts_pkey PRIMARY KEY (id);


--
-- Name: email_send_log email_send_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_send_log
    ADD CONSTRAINT email_send_log_pkey PRIMARY KEY (id);


--
-- Name: email_send_state email_send_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_send_state
    ADD CONSTRAINT email_send_state_pkey PRIMARY KEY (id);


--
-- Name: email_unsubscribe_tokens email_unsubscribe_tokens_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_unsubscribe_tokens
    ADD CONSTRAINT email_unsubscribe_tokens_email_key UNIQUE (email);


--
-- Name: email_unsubscribe_tokens email_unsubscribe_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_unsubscribe_tokens
    ADD CONSTRAINT email_unsubscribe_tokens_pkey PRIMARY KEY (id);


--
-- Name: email_unsubscribe_tokens email_unsubscribe_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_unsubscribe_tokens
    ADD CONSTRAINT email_unsubscribe_tokens_token_key UNIQUE (token);


--
-- Name: fixture_changes fixture_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixture_changes
    ADD CONSTRAINT fixture_changes_pkey PRIMARY KEY (id);


--
-- Name: fixtures fixtures_corporate_season_competition_match_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixtures
    ADD CONSTRAINT fixtures_corporate_season_competition_match_number_key UNIQUE (corporate, season, competition, match_number);


--
-- Name: fixtures fixtures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixtures
    ADD CONSTRAINT fixtures_pkey PRIMARY KEY (id);


--
-- Name: membership_applications membership_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_applications
    ADD CONSTRAINT membership_applications_pkey PRIMARY KEY (id);


--
-- Name: mfa_codes mfa_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_codes
    ADD CONSTRAINT mfa_codes_pkey PRIMARY KEY (id);


--
-- Name: mfa_sessions mfa_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_sessions
    ADD CONSTRAINT mfa_sessions_pkey PRIMARY KEY (id);


--
-- Name: mfa_sessions mfa_sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_sessions
    ADD CONSTRAINT mfa_sessions_session_id_key UNIQUE (session_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (id);


--
-- Name: suppressed_emails suppressed_emails_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppressed_emails
    ADD CONSTRAINT suppressed_emails_email_key UNIQUE (email);


--
-- Name: suppressed_emails suppressed_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppressed_emails
    ADD CONSTRAINT suppressed_emails_pkey PRIMARY KEY (id);


--
-- Name: timesheet_runs timesheet_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timesheet_runs
    ADD CONSTRAINT timesheet_runs_pkey PRIMARY KEY (day, kind);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: booking_waypoints_driver_recorded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_waypoints_driver_recorded_idx ON public.booking_waypoints USING btree (driver_id, recorded_at);


--
-- Name: booking_waypoints_reference_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_waypoints_reference_idx ON public.booking_waypoints USING btree (booking_reference, recorded_at);


--
-- Name: bookings_cleared_unreported_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_cleared_unreported_idx ON public.bookings USING btree (driver_status_at) WHERE ((driver_status = 'clear'::text) AND (job_report_sent_at IS NULL));


--
-- Name: bookings_driver_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_driver_idx ON public.bookings USING btree (driver_id, collection_at DESC);


--
-- Name: bookings_return_of_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_return_of_idx ON public.bookings USING btree (return_of) WHERE (return_of IS NOT NULL);


--
-- Name: driver_shifts_driver_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX driver_shifts_driver_started_idx ON public.driver_shifts USING btree (driver_id, started_at DESC);


--
-- Name: driver_shifts_one_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX driver_shifts_one_open_idx ON public.driver_shifts USING btree (driver_id) WHERE (ended_at IS NULL);


--
-- Name: driver_shifts_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX driver_shifts_started_idx ON public.driver_shifts USING btree (started_at);


--
-- Name: idx_bookings_collection_watch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_collection_watch ON public.bookings USING btree (collection_at) WHERE (status IS DISTINCT FROM 'Cancelled'::text);


--
-- Name: idx_bookings_user_collection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_user_collection ON public.bookings USING btree (user_id, collection_at DESC);


--
-- Name: idx_corporate_addresses; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corporate_addresses ON public.corporate_addresses USING btree (corporate, passenger_id);


--
-- Name: idx_corporate_passengers; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corporate_passengers ON public.corporate_passengers USING btree (corporate, grp, sort);


--
-- Name: idx_email_send_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_send_log_created ON public.email_send_log USING btree (created_at DESC);


--
-- Name: idx_email_send_log_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_send_log_message ON public.email_send_log USING btree (message_id);


--
-- Name: idx_email_send_log_message_sent_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_send_log_message_sent_unique ON public.email_send_log USING btree (message_id) WHERE (status = 'sent'::text);


--
-- Name: idx_email_send_log_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_send_log_recipient ON public.email_send_log USING btree (recipient_email);


--
-- Name: idx_fixture_changes_desk; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixture_changes_desk ON public.fixture_changes USING btree (corporate, detected_at DESC);


--
-- Name: idx_fixtures_desk_kickoff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_desk_kickoff ON public.fixtures USING btree (corporate, kickoff_utc);


--
-- Name: idx_mfa_codes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mfa_codes_user ON public.mfa_codes USING btree (user_id, created_at DESC);


--
-- Name: idx_mfa_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mfa_sessions_user ON public.mfa_sessions USING btree (user_id);


--
-- Name: idx_rate_limits_ip_endpoint_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limits_ip_endpoint_created ON public.rate_limits USING btree (ip_address, endpoint, created_at DESC);


--
-- Name: idx_suppressed_emails_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppressed_emails_email ON public.suppressed_emails USING btree (email);


--
-- Name: idx_unsubscribe_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unsubscribe_tokens_token ON public.email_unsubscribe_tokens USING btree (token);


--
-- Name: membership_applications_new_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX membership_applications_new_idx ON public.membership_applications USING btree (created_at DESC) WHERE (status = 'new'::text);


--
-- Name: profiles trg_protect_profile_columns; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_profile_columns BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();


--
-- Name: rate_limits trigger_cleanup_rate_limits; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_cleanup_rate_limits AFTER INSERT ON public.rate_limits FOR EACH STATEMENT EXECUTE FUNCTION public.cleanup_old_rate_limits();


--
-- Name: booking_waypoints booking_waypoints_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_waypoints
    ADD CONSTRAINT booking_waypoints_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: corporate_addresses corporate_addresses_passenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_addresses
    ADD CONSTRAINT corporate_addresses_passenger_id_fkey FOREIGN KEY (passenger_id) REFERENCES public.corporate_passengers(id) ON DELETE CASCADE;


--
-- Name: driver_shifts driver_shifts_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_shifts
    ADD CONSTRAINT driver_shifts_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: fixture_changes fixture_changes_fixture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixture_changes
    ADD CONSTRAINT fixture_changes_fixture_id_fkey FOREIGN KEY (fixture_id) REFERENCES public.fixtures(id) ON DELETE CASCADE;


--
-- Name: membership_applications membership_applications_handled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_applications
    ADD CONSTRAINT membership_applications_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES auth.users(id);


--
-- Name: mfa_codes mfa_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_codes
    ADD CONSTRAINT mfa_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_sessions mfa_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_sessions
    ADD CONSTRAINT mfa_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_primary_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_primary_member_id_fkey FOREIGN KEY (primary_member_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles Admins can read all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Admins can read all roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: membership_applications Admins can read applications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read applications" ON public.membership_applications FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: bookings_backup_20260818 Admins can read backup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read backup" ON public.bookings_backup_20260818 FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: membership_applications Admins can update applications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update applications" ON public.membership_applications FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: corporate_addresses Admins read all corporate addresses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read all corporate addresses" ON public.corporate_addresses FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: corporate_passengers Admins read all corporate passengers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read all corporate passengers" ON public.corporate_passengers FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: fixture_changes Admins read all fixture changes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read all fixture changes" ON public.fixture_changes FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: fixtures Admins read all fixtures; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read all fixtures" ON public.fixtures FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: corporate_addresses Corporate users read own address book; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Corporate users read own address book" ON public.corporate_addresses FOR SELECT TO authenticated USING (((corporate = ( SELECT p.corporate
   FROM public.profiles p
  WHERE (p.id = auth.uid()))) AND ((passenger_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.corporate_passengers cp
  WHERE ((cp.id = corporate_addresses.passenger_id) AND public.desk_group_allowed(auth.uid(), cp.grp)))))));


--
-- Name: fixture_changes Corporate users read own fixture changes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Corporate users read own fixture changes" ON public.fixture_changes FOR SELECT TO authenticated USING ((corporate = ( SELECT p.corporate
   FROM public.profiles p
  WHERE (p.id = auth.uid()))));


--
-- Name: fixtures Corporate users read own fixtures; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Corporate users read own fixtures" ON public.fixtures FOR SELECT TO authenticated USING ((corporate = ( SELECT p.corporate
   FROM public.profiles p
  WHERE (p.id = auth.uid()))));


--
-- Name: corporate_passengers Corporate users read own passenger list; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Corporate users read own passenger list" ON public.corporate_passengers FOR SELECT TO authenticated USING ((active AND (corporate = ( SELECT p.corporate
   FROM public.profiles p
  WHERE (p.id = auth.uid()))) AND public.desk_group_allowed(auth.uid(), grp)));


--
-- Name: driver_shifts Drivers read own shifts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Drivers read own shifts" ON public.driver_shifts FOR SELECT TO authenticated USING (((driver_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: booking_waypoints Drivers read own waypoints; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Drivers read own waypoints" ON public.booking_waypoints FOR SELECT TO authenticated USING (((driver_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: bookings Members can read own bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read own bookings" ON public.bookings FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: profiles Members can read own family; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read own family" ON public.profiles FOR SELECT TO authenticated USING ((primary_member_id = auth.uid()));


--
-- Name: bookings Primary members can read family bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Primary members can read family bookings" ON public.bookings FOR SELECT TO authenticated USING (public.is_family_member_of(user_id, auth.uid()));


--
-- Name: bookings Service role can insert bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert bookings" ON public.bookings FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: email_send_log Service role can insert send log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert send log" ON public.email_send_log FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: suppressed_emails Service role can insert suppressed emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert suppressed emails" ON public.suppressed_emails FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: email_unsubscribe_tokens Service role can insert tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: rate_limits Service role can manage rate limits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage rate limits" ON public.rate_limits TO service_role USING (true) WITH CHECK (true);


--
-- Name: email_send_state Service role can manage send state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage send state" ON public.email_send_state USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: email_unsubscribe_tokens Service role can mark tokens as used; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens FOR UPDATE USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: bookings_backup_20260818 Service role can read backup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read backup" ON public.bookings_backup_20260818 FOR SELECT TO service_role USING (true);


--
-- Name: bookings Service role can read bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read bookings" ON public.bookings FOR SELECT TO service_role USING (true);


--
-- Name: email_send_log Service role can read send log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read send log" ON public.email_send_log FOR SELECT USING ((auth.role() = 'service_role'::text));


--
-- Name: suppressed_emails Service role can read suppressed emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read suppressed emails" ON public.suppressed_emails FOR SELECT USING ((auth.role() = 'service_role'::text));


--
-- Name: email_unsubscribe_tokens Service role can read tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens FOR SELECT USING ((auth.role() = 'service_role'::text));


--
-- Name: email_send_log Service role can update send log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can update send log" ON public.email_send_log FOR UPDATE USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: mfa_codes Service role only mfa_codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role only mfa_codes" ON public.mfa_codes TO service_role USING (true) WITH CHECK (true);


--
-- Name: mfa_sessions Service role only mfa_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role only mfa_sessions" ON public.mfa_sessions TO service_role USING (true) WITH CHECK (true);


--
-- Name: profiles Users can read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: user_roles Users can read own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own roles" ON public.user_roles FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));


--
-- Name: booking_waypoints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_waypoints ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings_backup_20260818; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings_backup_20260818 ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_addresses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_addresses ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_passengers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_passengers ENABLE ROW LEVEL SECURITY;

--
-- Name: driver_shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.driver_shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: email_send_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

--
-- Name: email_send_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;

--
-- Name: email_unsubscribe_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: fixture_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixture_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: fixtures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixtures ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.membership_applications ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mfa_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mfa_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: suppressed_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: timesheet_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.timesheet_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


