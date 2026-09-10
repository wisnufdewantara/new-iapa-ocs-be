-- Trigger function & trigger yang TIDAK dikelola Prisma (Prisma cuma
-- push tabel/kolom dari schema.prisma) — ini migrasi manual dari
-- database lama (Supabase), harus direplikasi manual tiap kali bikin
-- database baru (mis. staging) via `prisma db push`.
--
-- Cara pakai: DATABASE_URL="...staging..." psql "$DATABASE_URL" -f prisma/staging-triggers.sql
-- atau lewat node/prisma $executeRawUnsafe (lihat catatan di SESSION_NOTES.md).

CREATE OR REPLACE FUNCTION public.create_payment_for_participant()
RETURNS trigger
LANGUAGE plpgsql
AS $function$BEGIN
    IF NEW.is_member = TRUE THEN
        NEW.total_amount := 300000;
    ELSE
        NEW.total_amount := 500000;
    END IF;
    NEW.payment_status := 'waiting for calculation';
    RETURN NEW;
END;$function$;

CREATE OR REPLACE FUNCTION public.create_payment_on_acceptance()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.paper_status = 'Accepted' THEN
        IF NOT EXISTS (
            SELECT 1 FROM sisko.payments WHERE paper_id = NEW.paper_id
        ) THEN
            INSERT INTO sisko.payments (paper_id, submitter_id, total_amount, payment_status, due_date, sent_invoice, payment_type)
            VALUES (
                NEW.paper_id,
                NEW.submitter_id,
                NULL,
                'waiting for calculation',
                NULL,
                FALSE,
                'team'
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_create_payment ON sisko.papers;
CREATE TRIGGER trigger_create_payment
    AFTER INSERT OR UPDATE ON sisko.papers
    FOR EACH ROW EXECUTE FUNCTION public.create_payment_on_acceptance();

DROP TRIGGER IF EXISTS trigger_create_participant_payment ON sisko.participant;
CREATE TRIGGER trigger_create_participant_payment
    BEFORE INSERT ON sisko.participant
    FOR EACH ROW EXECUTE FUNCTION public.create_payment_for_participant();

DROP TRIGGER IF EXISTS trigger_update_participant_payment ON sisko.participant;
CREATE TRIGGER trigger_update_participant_payment
    BEFORE UPDATE ON sisko.participant
    FOR EACH ROW EXECUTE FUNCTION public.create_payment_for_participant();
