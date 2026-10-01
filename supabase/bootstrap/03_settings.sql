--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: service_plan_templates; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.service_plan_templates VALUES ('bacaa868-a816-496a-aa33-2f2c7b16acd4', 'Engine oil', 10000, 180, 10, true, '2026-09-29 15:58:26.405886+00');
INSERT INTO public.service_plan_templates VALUES ('8886a7fd-d0ec-4205-8968-88030d7cef78', 'Brake pads', 40000, 365, 20, true, '2026-09-29 15:58:26.405886+00');
INSERT INTO public.service_plan_templates VALUES ('190d3b1b-1b6c-409c-a277-455d94ade2b9', 'Tyres', 50000, 730, 30, true, '2026-09-29 15:58:26.405886+00');
INSERT INTO public.service_plan_templates VALUES ('0c1ad46f-83b8-4142-b75b-61d549d0557e', 'Air filter', 20000, 365, 40, true, '2026-09-29 15:58:26.405886+00');
INSERT INTO public.service_plan_templates VALUES ('738e50ba-cc12-45b1-a9a6-a443407852b7', 'Coolant', 40000, 730, 50, true, '2026-09-29 15:58:26.405886+00');
INSERT INTO public.service_plan_templates VALUES ('5c1dc2b5-c289-4c5f-ba27-90cb35da0979', 'Battery', NULL, 1095, 60, true, '2026-09-29 15:58:26.405886+00');
INSERT INTO public.service_plan_templates VALUES ('c096a5d8-a152-4e52-971a-83bcf9f1f90b', 'Clutch', 80000, NULL, 70, true, '2026-09-29 15:58:26.405886+00');
INSERT INTO public.service_plan_templates VALUES ('ca3b89ec-2fd1-4678-8221-56c108870174', 'Fuel filter', 20000, 365, 80, true, '2026-09-29 15:58:26.405886+00');
INSERT INTO public.service_plan_templates VALUES ('97b76a74-0d8c-421c-bbfd-4b8fc7833fe8', 'General service', 15000, 180, 90, true, '2026-09-29 15:58:26.405886+00');


--
-- Data for Name: system_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.system_settings VALUES ('licence_grace_days', '{"value": 0}', '2026-09-29 14:41:24.853634+00');
INSERT INTO public.system_settings VALUES ('document_retention_days', '{"value": 365}', '2026-09-29 14:41:24.853634+00');
INSERT INTO public.system_settings VALUES ('bank_change_cooldown_hours', '{"value": 24}', '2026-09-29 14:41:24.853634+00');
INSERT INTO public.system_settings VALUES ('driver_document_enforcement', '{"value": "warn"}', '2026-09-29 14:41:24.853634+00');


--
-- PostgreSQL database dump complete
--


