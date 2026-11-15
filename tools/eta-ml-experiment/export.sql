SELECT c."JoinedAt" AS "observedAt",
       b.started_at AS "startedAt",
       s."WaitingAhead" AS "waitingAhead",
       s."ServingRooms" AS "servingRooms",
       s."BusyRooms" AS "busyRooms",
       s."ConsultationMinutes" AS "consultationMinutes",
       CASE WHEN s."UsesFallback" THEN 'true' ELSE 'false' END AS "usesFallback"
FROM opd_estimate_samples s
JOIN opd_check_ins c ON c."BookingId" = s."BookingId"
JOIN opd_bookings b ON b.id = s."BookingId"
WHERE b.started_at IS NOT NULL AND b.started_at >= c."JoinedAt"
ORDER BY c."JoinedAt", b.id;
