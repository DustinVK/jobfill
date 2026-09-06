# Classifier corpus — per-field results

Snapshot of ACTUAL classifier output (tests/unit/corpus.dom.test.ts); regenerate with
`npx vitest run corpus -u` and review the diff.

Fixtures: 57 | positive expectations: 81 | deny expectations: 12 | must-not-classify: 7

| Fixture / field | Expected | Got | Tier | Signal | Score |
|---|---|---|---|---|---|
| about-yourself.html #ab | summary | summary | auto | label | 0.90 |
| autocomplete-affixes.html #h | identity.honorific | identity.honorific | auto | autocomplete | 1.00 |
| autocomplete-affixes.html #sa | address.full | address.full | auto | autocomplete | 1.00 |
| autocomplete-affixes.html #sfx | identity.suffix | identity.suffix | auto | autocomplete | 1.00 |
| autocomplete-off-ignored.html #f | identity.firstName | identity.firstName | auto | label | 0.90 |
| autocomplete-off-ignored.html #l | identity.lastName | identity.lastName | auto | label | 0.90 |
| autocomplete-tokens.html #a | identity.firstName | identity.firstName | auto | autocomplete | 1.00 |
| autocomplete-tokens.html #b | identity.lastName | identity.lastName | auto | autocomplete | 1.00 |
| autocomplete-tokens.html #c | contact.email | contact.email | auto | autocomplete | 1.00 |
| autocomplete-tokens.html #d | address.postalCode | address.postalCode | auto | autocomplete | 1.00 |
| autocomplete-tokens.html #e | contact.phone | contact.phone | auto | autocomplete | 1.00 |
| country-code-not-country.html #cc | contact.phoneCountryCode | contact.phoneCountryCode | auto | label | 0.90 |
| cover-letter-textarea.html #cl | coverLetter.text | coverLetter.text | auto | label | 0.90 |
| cover-letter-upload.html #c | documents.coverLetter | documents.coverLetter | auto | label | 0.90 |
| current-location.html #cur-loc | address.full | address.full | suggest | placeholder | 0.60 |
| div-question-radios.html #sp-yes | answers.sponsorship | answers.sponsorship | suggest | question | 0.85 |
| div-question-radios.html #wa-yes | answers.workAuthorization | answers.workAuthorization | suggest | label | 0.90 |
| div-question-salary.html #sal-div | answers.salaryExpectation | answers.salaryExpectation | suggest | label | 0.90 LOCK |
| education-block.html #deg | education[0].degree | education[0].degree | auto | label | 0.90 |
| education-block.html #fos | education[0].field | education[0].field | auto | label | 0.90 |
| education-block.html #gpa | education[0].gpa | education[0].gpa | auto | label | 0.90 |
| education-block.html #sch | education[0].school | education[0].school | auto | label | 0.90 |
| eeo-block.html #d | eeo.disabilityStatus | eeo.disabilityStatus | suggest | label | 0.90 LOCK |
| eeo-block.html #g | eeo.gender | eeo.gender | suggest | label | 0.90 LOCK |
| eeo-block.html #r | eeo.race | eeo.race | suggest | label | 0.90 LOCK |
| eeo-block.html #v | eeo.veteranStatus | eeo.veteranStatus | suggest | label | 0.90 LOCK |
| eeo-ethnicity.html #e | eeo.ethnicity | eeo.ethnicity | suggest | label | 0.90 LOCK |
| email-confirm-negative.html #e1 | contact.email | contact.email | auto | label | 0.90 |
| greenhouse-basics.html #email | contact.email | contact.email | auto | label | 0.90 |
| greenhouse-basics.html #first_name | identity.firstName | identity.firstName | auto | label | 0.90 |
| greenhouse-basics.html #last_name | identity.lastName | identity.lastName | auto | label | 0.90 |
| greenhouse-basics.html #phone | contact.phone | contact.phone | auto | label | 0.90 |
| how-did-you-hear.html #h | answers.howDidYouHear | answers.howDidYouHear | suggest | label | 0.90 |
| lever-fullname.html #email | contact.email | contact.email | auto | label | 0.90 |
| lever-fullname.html #name | identity.fullName | identity.fullName | auto | label | 0.90 |
| lever-fullname.html #org | work[0].company | work[0].company | auto | label | 0.90 |
| lever-resume-hidden.html #resume-upload-input | documents.resume | documents.resume | suggest | nameId | 0.70 |
| lever-url-fields.html #u1 | links.linkedin | links.linkedin | suggest | nameId | 0.70 |
| lever-url-fields.html #u2 | links.github | links.github | suggest | nameId | 0.70 |
| links-block.html #gh | links.github | links.github | auto | label | 0.90 |
| links-block.html #li | links.linkedin | links.linkedin | auto | label | 0.90 |
| links-block.html #pf | links.portfolio | links.portfolio | auto | label | 0.90 |
| links-block.html #ws | links.website | links.website | auto | label | 0.90 |
| lone-name-vs-explicit-first.html #fn | identity.firstName | identity.firstName | auto | label | 0.90 |
| lone-name-vs-explicit-first.html #n | identity.fullName | identity.fullName | auto | label | 0.90 |
| middle-preferred.html #mid | identity.middleName | identity.middleName | auto | label | 0.90 |
| middle-preferred.html #pref | identity.preferredName | identity.preferredName | auto | label | 0.90 |
| notice-period-question.html #np | answers.noticePeriod | answers.noticePeriod | suggest | question | 0.85 |
| over18.html #o | answers.over18 | answers.over18 | suggest | label | 0.90 |
| passport-upload-deny.html #r | documents.resume | documents.resume | auto | label | 0.90 |
| phone-parts.html #cc | contact.phoneCountryCode | contact.phoneCountryCode | auto | label | 0.90 |
| phone-parts.html #num | contact.phone | contact.phone | auto | label | 0.90 |
| phone-type-select.html #pt | contact.phoneType | contact.phoneType | auto | label | 0.90 |
| plain-address.html #a1 | address.line1 | address.line1 | auto | label | 0.90 |
| plain-address.html #a2 | address.line2 | address.line2 | auto | label | 0.90 |
| plain-address.html #city | address.city | address.city | auto | label | 0.90 |
| plain-address.html #country | address.country | address.country | auto | label | 0.90 |
| plain-address.html #state | address.state | address.state | auto | label | 0.90 |
| plain-address.html #zip | address.postalCode | address.postalCode | auto | label | 0.90 |
| previously-employed.html #pe | answers.previouslyEmployedHere | answers.previouslyEmployedHere | suggest | question | 0.85 |
| professional-summary.html #sum | summary | summary | auto | label | 0.90 |
| pronouns.html #p | identity.pronouns | identity.pronouns | auto | label | 0.90 |
| referral-name.html #rn | answers.referralName | answers.referralName | auto | label | 0.90 |
| relocation.html #rel | answers.relocation | answers.relocation | suggest | label | 0.90 |
| remote-preference-question.html #rp | answers.remotePreference | answers.remotePreference | suggest | question | 0.85 |
| resume-upload.html #r | documents.resume | documents.resume | auto | label | 0.90 |
| salary-expectation.html #sal | answers.salaryExpectation | answers.salaryExpectation | suggest | label | 0.90 LOCK |
| signup-anti-pattern.html #fn | identity.firstName | identity.firstName | auto | label | 0.90 |
| signup-anti-pattern.html #ln | identity.lastName | identity.lastName | auto | label | 0.90 |
| skills-input.html #sk | skills | skills | auto | label | 0.90 |
| sponsorship-question.html #sp | answers.sponsorship | answers.sponsorship | suggest | question | 0.85 |
| why-join.html #w | coverLetter.text | coverLetter.text | suggest | label | 0.90 |
| work-auth-question.html #wa | answers.workAuthorization | answers.workAuthorization | suggest | question | 0.85 |
| work-basics.html #co | work[0].company | work[0].company | auto | label | 0.90 |
| work-basics.html #ti | work[0].title | work[0].title | auto | label | 0.90 |
| work-dates.html #ed | work[0].endDate | work[0].endDate | auto | label | 0.90 |
| work-dates.html #sd | work[0].startDate | work[0].startDate | auto | label | 0.90 |
| work-summary-textarea.html #resp | work[0].summary | work[0].summary | auto | label | 0.90 |
| workday-description.html #d | work[0].summary | work[0].summary | auto | ariaLabel | 0.85 |
| workday-names.html #in1 | identity.firstName | identity.firstName | suggest | nameId | 0.70 |
| workday-names.html #in2 | identity.lastName | identity.lastName | suggest | nameId | 0.70 |
