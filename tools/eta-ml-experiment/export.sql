SELECT c."JoinedAt" AS "observedAt",
       b.called_at AS "calledAt",
       s."WaitingAhead" AS "waitingAhead",
       s."ServingRooms" AS "servingRooms",
       s."BusyRooms" AS "busyRooms",
       s."ConsultationMinutes" AS "consultationMinutes"
FROM opd_estimate_samples s
JOIN opd_check_ins c ON c."BookingId" = s."BookingId"
JOIN opd_bookings b ON b.id = s."BookingId"
WHERE b.status = 'Completed'
  AND s."ServingRooms" > 0 AND s."ServingRooms" <= 1000
  AND s."WaitingAhead" BETWEEN 0 AND 10000
  AND s."BusyRooms" BETWEEN 0 AND s."ServingRooms"
  AND s."ConsultationMinutes" BETWEEN 1 AND 180
  AND b.called_at >= c."JoinedAt"
  AND b.called_at <= c."JoinedAt" + interval '24 hours'
  AND b.completed_at >= b.called_at
  AND s."ObservedAt" >= c."JoinedAt"
  AND s."ObservedAt" <= c."JoinedAt" + interval '5 seconds'
  AND b.queue_entered_at = c."JoinedAt"
  AND b.opd_date = (c."JoinedAt" AT TIME ZONE 'Asia/Colombo')::date
  AND NOT EXISTS (SELECT 1 FROM opd_queue_events e
                  WHERE e."BookingId" = b.id AND e."Action" IN ('no-show', 'requeue'))
ORDER BY c."JoinedAt", b.id;
