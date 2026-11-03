# Chauffeur app, feedback register

Everything the chauffeurs have reported, in one place, so the next build can
answer all of it at once. Items keep their number for the life of the register
so a later message can refer to one without ambiguity.

Target: everything below fixed and tested before the lads are back on 16 Nov 2026.

Status key: OPEN, IN BUILD, FIXED, WON'T DO.

FIXED means written and tested. Nothing goes to the chauffeurs until the
whole list is done and we ship one build.

---

## Batch 1: Faz Hussain, 31 Oct 2026

All from one as-directed City job, 05:20 collection at Signature Aviation,
Khaldoon Al Mubarak and Abdulla Khouri, Range Rover R26 APX, on 2.1 (16).

Worth noting before the list: Faz told the other chauffeurs to use the app for
every job Sally gives out. So City work is now the main thing the app is being
judged on, and City work is the path with the least road time on it.

### D1. Drive refuses the job: "no postcode, so there is nothing to navigate to"
**FIXED, not released. Highest.** Screenshot 04:10.

Faz pressed Drive at the start of the job and got a dead end. He could not
navigate to the collection at all, and told the other chauffeurs to ignore the
Drive button for the rest of the day.

The job itself shows a complete address with a postcode in it: Signature
Aviation, Hangar 7, Fairey's Way, Manchester M90 5NE. So the postcode is
present in the address text but the postcode field our navigation reads is
empty. City jobs arrive from the booking system rather than through our own
form, which is why ours are fine and theirs are not.

Should: navigate on the whole address, not the postcode field alone, and only
ask the chauffeur to type somewhere when there is genuinely nothing to work
with.

### D2. Drive still showing after it has been pressed
**FIXED, not released.** Screenshot 04:19, and Faz at 07:26.

Pressing Drive set the job to En route, but the Drive button stayed exactly as
it was, so it reads as a step still to do. Faz asked for it to either disappear
once pressed or be relabelled "En route to pick up point".

### D3. Clear sits directly under Passenger back on board
**FIXED, not released. High.** Screenshot 06:32, and Faz at 09:30.

The two are stacked with nothing between them and Clear is the same size, so a
thumb finds it by accident and the job ends. Faz asked for a confirm step or a
smaller button.

Should: ask "are you sure" before clearing. There is already a thirty minute
undo, but an undo is a rescue and a confirm is a prevention, and the office
gets told either way once the window passes.

### D4. "Could not save that. Something went wrong. Please try again."
**REPORTING FIXED, cause still open.** Screenshots 06:31 and 06:32.

The failure now names itself: the chauffeur is told the address would not
save and to tell the office, and the reference, the address and the database's
own complaint go into the log. It was landing in the catch-all, which named
nothing and left nothing behind to look at.

What actually broke is still unknown. The best guess is the same family as
D20, a column or a constraint the insert does not satisfy, since both
failures are the same insert from two directions. The next one to happen will
say so itself.

Faz searched "City football acad", picked City Football Academy from the
suggestions, and the save failed. That is the destination box, the one thing an
as-directed hire depends on, and the message tells him nothing about what to do
next. Needs the function log for 06:32 on 31 Oct to say why. The wording is our
catch-all, so the real reason is only in the log.

### D5. Choosing a destination does not start navigation
**ALREADY BUILT. It was D4 breaking it.** Faz at 09:32.

Picking an address does start the drive. What happened to Faz is that the
address never saved, so there was nothing to drive to and nothing said why.
Verify on a real job once D4 and D20 are out; if it still misbehaves then it
is a genuine fault and this reopens.

He expected that typing where the client wants to go would bring the sat nav up
by itself. It does not. Either make it do that, or make the Drive button
obviously point at the new destination once one is given.

### D6. Comments during a job
**OPEN. Faz's own request.** 07:41.

A place to type notes as the job runs, timestamped into the same list as the
progress steps, and editable:

    06:06  En route
    06:30  Purchased drinks, paid by Amex
    06:45  Passenger on board

They should travel with the job when it is cleared, so the office and accounts
see what actually happened. The step timeline already exists at the foot of the
job, so this is a note entry added to it rather than anything new.

### D7. "Passenger back on board" is cut off
**FIXED, not released.** Screenshots 05:41 and 06:32.

The text runs off the right edge of the phone and the car icon is clipped on
the left. Longest label in the app, and it looks broken on an iPhone.

### D8. The vehicle registration vanishes mid-job
**FIXED, not released.** Compare 04:19 with 05:41.

The last registration we were given is kept and shown when a live lookup
comes back empty, which is a truer thing to show than nothing. D12 makes the
empty answers much rarer in the first place.

At 04:19 the job reads "Range Rover, R26 APX, 2 up". At 05:41 it reads "Range
Rover, 2 up". The registration comes from the live booking-system lookup, so
when that lookup fails the reg quietly disappears and nobody is told. Same
silent-failure pattern as the desk portal losing the chauffeur's name.

### D9. Waiting recorded as "Medlock Manchester, unparished area, M11 4DW"
**FIXED, not released.** Screenshot 06:32.

The lookup was led by the parish, which in a city is literally the words
"unparished area". For that postcode it returns parish "Manchester,
unparished area" and ward "Clayton & Openshaw". It now leads on the ward and
only takes a parish that is a real one, so the same stop reads "Clayton &
Openshaw, M11 4DW".

The place name we write against a stop is coming back as administrative
geography rather than anywhere a person would recognise.

### D10. Job title slides under the status bar
**OPEN. Cosmetic.** Screenshot 06:31.

Scrolling puts the passenger name behind the clock and the Dynamic Island.

### D11. Faz is not on TestFlight
**OPEN.** Only one tester is registered, so Faz is testing whatever build is on
his phone rather than the one being worked on.

### D12. A job allocated to a chauffeur never reached his app
**FIXED, not released.** Separate report, 30 Oct.

Three faults, all in the one pass:

- It asked Dispatch about every booking in a sixty hour window, once a
  minute, for every chauffeur signed on. It now asks about jobs going spare,
  which is what discovery is for, and this chauffeur's own, which is where
  the car and the live status on his screen come from.
- It ignored the thirty second lock and recorded nothing, so one phone on a
  kerb held a lock on every reference in the diary and the five minute sweep
  walked into it believing a column this function never wrote. It now honours
  the lock and records every ask, like the sweep does.
- There was no limit on the request at all, so it would have failed outright
  on a busy match week, silently, taking every chauffeur's new jobs with it.
  It is capped.

A chauffeur Dispatch names with no mobile on him is now written to the log,
which is the only trace there is until the desk gets a screen for it. That
wants a table, so it wants a migration, so it is not in this change.

**Still true, and worth knowing.** A member watching their own car checks it
every fifteen seconds, which is inside the thirty second lock, so heavy
watching can still hold discovery off a booking. We no longer cause that; we
can no longer fix it from here either. The real answer is for one sweep to
own all contact with Dispatch and for every screen to read our own database.
That is the dispatch replacement, and it removes this whole class of fault.

Faz had an evening job correctly allocated to him in the booking system that
never appeared in the app, while the next day's job showed fine. A job only
ever reaches a chauffeur if, while he is signed on, the booking system answers
our minute-by-minute request and returns a chauffeur mobile matching the phone
on his profile. Nothing in our app can put a job in his hands by hand, and when
the match misses, nobody is told.

Needs: ask only about jobs with no chauffeur yet, respect and record the thirty
second lock the five minute sweep already respects, cap the request, show the
desk when the booking system names a chauffeur we do not recognise, and let the
desk assign a job by hand.

---

## Batch 2: team testing group, 29 Oct to 2 Nov 2026

From Faz, Iman, Zed and a chauffeur out on a job, plus the member app this
time, not only the chauffeur app.

### D13. Card payment
**OPEN. Own project, not a bug.** Iman and Vanessa, 29 Oct.

Clients are being emailed card details, which Iman rightly called ancient. The
club is on account, individual clients are mostly card now. Wanted: pay in the
app. This is a build of its own and needs a decision before any code.

### D14. Call-on reminders for chauffeurs, with an answer back
**OPEN. High value, low difficulty.** Faz 31 Oct, backed by Zed and Iman.

An alert two hours before the job and again one hour before, and the chauffeur
taps back to say they are awake or on the way, so the booking team can see it.
Today the office chases every chauffeur on WhatsApp to find out. This replaces
a daily manual job, so it is worth doing properly.

### D15. The car is in the wrong place on the map
**OPEN.** Faz 2 Nov, screenshots 07:27 and 10:12.

Faz says the car should have been on Donkey Lane. The 07:27 shot also reads
"updated 18 min ago, your chauffeur's phone may have lost signal", so some of
this is the phone going to sleep and not reporting rather than a bad fix. The
two need separating: a stale position and a wrong position are different
faults and right now they look identical to whoever is watching.

### D16. You cannot tell the cars apart on the map
**NOT THIS APP. Moved to the dispatch build.** Faz 2 Nov, settled 3 Nov.

Faz was describing the way Uber shows several cars on a customer's map, and
what the call centre will need once our own dispatch is live: one map with
every chauffeur on it. Neither is this app. It goes on the dispatch platform's
list, where the live map already is, and the registration or the name on each
marker is a requirement of that screen rather than a fix here.

Kept in this register only so it is not raised here a third time.

The original note, which stands as the reason it is not buildable here:

Faz wants the registration or the chauffeur's name on the marker so that with
several cars out you can tell which is which.

There is no map in this app that shows several cars. There are two maps and
only two: the passenger's, which shows the one car coming for them, and the
chauffeur's own driving map. Nothing renders a fleet. So either Faz means the
live map in the separate dispatch platform, which is a different codebase, or
he is asking for an operations map that does not exist yet and is a build of
its own rather than a label on a marker.

Worth asking him which he had in front of him. Labelling the passenger's
marker would take ten minutes and answer nobody's actual problem: that card
already names the chauffeur and the registration directly above the map.

### D17. Being on board should start the navigation
**ALREADY BUILT.** Faz 2 Nov. Same ground as D5.

Pressing Passenger on board opens the driving screen on the destination by
itself. On an hourly hire it asks where to first, because nobody has said
yet, and that ask is what D4 was breaking.

Once the passenger is aboard and the chauffeur presses drive, the map should
take over by itself.

### D18. Offer a choice of routes
**OPEN. Feature.** Faz 2 Nov.

Three options the way Google and Waze give them. Main roads are often worth a
couple of extra minutes over A roads and country lanes, and that judgement
belongs to the chauffeur, not to us.

### D19. The navigation is not good enough to drive by
**PART FIXED. The rest is the next piece of work.** A chauffeur via Faz, 2 Nov.

Done:

- **Speed.** The phone has reported it on every fix since the screen was
  written and we threw it away. It now sits bottom right, opposite the camera
  warning, where every sat nav puts it. It matters more than it sounds: he was
  being warned about a camera and its limit with no way of telling whether the
  warning concerned him without looking at the dashboard.
- **Closing in at junctions.** The map sat at one zoom the whole way, which is
  most of why it was called too small and hard to follow. It now opens out on
  a clear run and closes in twice as a turn comes up.

Checked and nothing wrong:

- **Speed cameras.** They are drawn on both maps and spoken aloud, the voice
  is on unless somebody turned it off, and the file ships inside the app with
  3,557 cameras covering the whole country, 92 of them around Manchester and
  Wilmslow. On the route he drove there were most likely none. Worth telling
  the chauffeurs what to expect rather than changing anything.

Left:

- **Traffic signs**, meaning speed limits on ordinary roads. We hold a limit
  for about half the cameras and nothing at all for the roads between them.
  This needs a data source we do not have, so it is a decision about buying
  one rather than a fix.
- **Sensible roads instead of the shortest.** This is D18. Google optimises
  for time, which is exactly how a car ends up down country lanes, and there
  is no setting that says prefer main roads. Letting the chauffeur choose is
  the answer, and it answers both complaints at once.

All of it from one job:

- No speed shown
- No speed cameras shown
- The map is too small and hard to follow
- It does not zoom in at junctions or say what is coming, the way Waze does
- No traffic signs
- It sent the car down country roads all day, shortest rather than sensible

This is the single biggest piece of work in the list and it is what the
chauffeurs judge the app on, because it is the part they use at speed.

### D20. The passenger's "where would you like to go" box has never worked
**FIXED, not released. Highest. Cause confirmed.** Iman 2 Nov 13:13, screenshot 10:12.

"We could not pass that on. An error occurred processing your request."

Confirmed from the database schema, not guessed. `booking_waypoints.driver_id`
cannot be empty, and the member handler inserts a row without it. So the insert
has failed every single time the box has been used, which is why Iman said it
keeps erroring. The chauffeur app sends that column and the member app does
not.

Iman also reported her dad getting an error on the chauffeur app. That is a
different code path with a different message, so treat it as D4 until proven
otherwise.

### D21. "Could not work out a route just now"
**FIXED, likely cause. Not released.** Screenshot 11:09, 2 Nov.

Found in the code rather than in a log, so it is a strong reading and not a
certainty. Google answers quite happily with an empty list when it cannot
find a way through: a door inside a pedestrian area, a car park entrance, a
point sitting just off the road network. We only fell back to the other
router when Google threw, so an empty answer went to the chauffeur as a route
in a shape we could not read, and he was stopped.

It now falls back, which is very likely to produce a route, because the open
router is far less fussy about where it starts. If both fail he is told there
is no route to the address, rather than being handed the word "shape".

"The google route came back in a shape we could not read." The route came back
and we could not parse it. Needs the route function log for 11:09 on 2 Nov.

### D22. No arrival time once the passenger is aboard
**FIXED, not released.** Iman 2 Nov 14:46.

The cause was not a missing feature. The arrival time has always handled a
passenger on board, and the 07:33 and 08:28 screenshots show it working, with
the aboard wording, on a journey to Keele. It only ever existed while the
chauffeur was navigating in the app, because the number came from their sat
nav and nowhere else. After D1 stopped City jobs navigating, Faz told the
chauffeurs to ignore the drive button, and every passenger lost their arrival
time the same morning. Nobody joined the two up, and the travel team went back
to being rung and asked how long.

The chauffeur's own number is still preferred, because it is the one they are
driving to. Where there is none, the car's last position is now routed to
where it is going, once a minute, and the passenger is told that instead. An
hourly hire is the exception: where it is heading lives on the chauffeur's job
and the passenger's phone has never been told, so there is still nothing to
route to. That is D6 and D17 ground, not this.

There is an arrival time while the car is coming to collect: the 08:28 and
08:29 screenshots show "Arriving about 08:30, about 2 minutes away" and then
"Arriving now". The 11:46 screenshot, with the passenger on board, shows no
arrival time at all. So the member can see when the car will reach them but
not when they will reach where they are going, which is the half they care
about once they are sitting in it.

### D23. Amending a collection time in the booking system
**OPEN. Question, needs an answer not code.** Iman 30 Oct.

Iman asked whether amending a collection time at their end breaks anything, and
whether a change should just go in the notes instead. She also had a duplicate
booking from Jon Bell and deleted one. Until our own dispatch is in, somebody
has to give the desk a straight rule on this.

### D24. A screen recording from 2 Nov
**OPEN. Not yet read.**

WhatsApp Video 2026-11-02 at 10.38.33.mp4, in Downloads. Nothing here can play
video, so this needs either a description or a few stills pulled out of it.
Going by the timestamp it sits with D15 and D16.

---

## Batch 3: audit of the screenshots and the transcript, 3 Nov 2026

Not reported by anyone. Found by going back over the images and the messages
against the code, after Jimmy asked whether everything had been covered.

### D25. No way to type an address when the one on the job will not navigate
**FIXED, not released. High.** Jimmy said this himself on 31 Oct at 07:20, and it never got
written down.

When the sat nav cannot work with the address, the chauffeur gets a dead end:
"Try again" and "Back to the job". The box for typing somewhere else only
appears on hourly hires, so on an ordinary journey with a bad address there is
no way forward inside the app at all. D1 makes this rarer. It does not remove
it, and the one thing a chauffeur at the kerb needs is a way out.

### D26. Amend and Cancel are offered while the passenger is in the car
**FIXED, not released.** Screenshot 11:46, 2 Nov.

The job reads "On board" and still shows Amend and Cancel Booking. Cancelling
a journey you are sitting in is not a thing anybody should be one tap from,
least of all a passenger holding a phone in a moving car.

### D27. The error message covers the top of the screen
**OPEN. Cosmetic.** Screenshots 06:32 on 31 Oct and 10:12 on 2 Nov.

Both error messages sit over the header and the sign out link. Twice in two
days, so it is where errors always land rather than bad luck.

### D28. "At your destination" when the car reaches the collection
**WITHDRAWN. I was wrong.** Screenshot 08:29, 2 Nov.

I read that screenshot as a collection. It was not. "Arriving" and "At your
destination" are only ever used once the passenger is aboard; a collection
reads "Collecting you" and "At the collection point". The wording was correct
and the passenger was on board on the way to Keele. Left in the list rather
than deleted, so nobody goes looking for it twice.

### D29. A job worked in the morning read "Not started" that afternoon
**OPEN. Verify before treating as a fault.** Screenshot 15:50, 31 Oct.

The 05:20 job had been taken through to waiting by 05:40, and at 15:50 the
same passengers and collection show as Not started on a fresh shift. It may
be the return leg, which the notes say departs Signature at 19:30, in which
case this is correct and only the 05:20 time is misleading. Worth ten minutes
with the two booking references before anybody changes anything.

### D30. The app does nothing without a signal
**OPEN. Mine, not theirs. Raise before 16 Nov.**

Every press a chauffeur makes is a live call to the server. In an airport
tunnel or under the Etihad, pressing Arrived fails and tells them it was not
saved. Nobody has reported it because nobody has lost signal at the wrong
moment yet. They will. Faz already guessed at it on 2 Nov when he put the
errors down to a bad signal area, which is a sign of where confidence sits.

---

## Batch 4

Awaiting. Keep numbering from D31.
