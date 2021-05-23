/*   Contact AddressBook Pane
**
**  This outline pane allows a user to interact with an contact,
to change its state according to an ontology, comment on it, etc.
**
** See also things like
**  http://www.w3.org/TR/vcard-rdf/
**  http://tools.ietf.org/html/rfc6350
**  http://www.iana.org/assignments/vcard-elements/vcard-elements.xhtml
**
** Feross "Standard" style note:  Callback functions should not be called "callback"
** or the "standard"  linter will complain if the first param is not a node.js error code. (2018-01)
** Hence "callbackFunction"
*/
/* global alert, confirm */

import * as UI from 'solid-ui'
import { toolsPane } from './toolsPane'
import { mintNewAddressBook } from './mintNewAddressBook'
import { renderIndividual } from './individual'
import { saveNewContact, saveNewGroup, addPersonToGroup } from './contactLogic'

// const $rdf = UI.rdf
const ns = UI.ns
const utils = UI.utils

export default {
  icon: UI.icons.iconBase + 'noun_99101.svg', // changed from embedded icon 2016-05-01

  name: 'contact',

  // Does the subject deserve an contact pane?
  label: function (subject, context) {
    const t = context.session.store.findTypeURIs(subject)
    if (t[ns.vcard('Individual').uri]) return 'Contact'
    if (t[ns.vcard('Organization').uri]) return 'contact'
    if (t[ns.foaf('Person').uri]) return 'Person'
    if (t[ns.schema('Person').uri]) return 'Person'
    if (t[ns.vcard('Group').uri]) return 'Group'
    if (t[ns.vcard('AddressBook').uri]) return 'Address book'
    return null // No under other circumstances
  },

  mintClass: UI.ns.vcard('AddressBook'),

  mintNew: mintNewAddressBook, // Make a new address book

  //  Render the pane
  render: function (subject, dataBrowserContext, paneOptions = {}) {
    const thisPane = this

    // stick functions here
    function complain (message) {
      console.log('contactsPane: ' + message)
      div.appendChild(UI.widgets.errorMessageBlock(dom, message, 'pink'))
    }
    function complainIfBad (ok, body) {
      if (!ok) {
        complain('Error: ' + body)
      }
    }

    //  Reproduction: Spawn a new instance of this app
    function newAddressBookButton (thisAddressBook) {
      return UI.authn.newAppInstance(
        dom,
        { noun: 'address book', appPathSegment: 'contactorator.timbl.com' },
        function (ws, newBase) {
          thisPane.clone(thisAddressBook, newBase, { // @@ clone is not a thing - use mintNew
            me: me,
            div: div,
            dom: dom
          })
        }
      )
    } // newAddressBookButton

    const dom = dataBrowserContext.dom
    const kb = dataBrowserContext.session.store
    const div = dom.createElement('div')
    const me = UI.authn.currentUser() // If already logged on

    UI.aclControl.preventBrowserDropEvents(dom) // protect drag and drop

    div.setAttribute('class', 'contactPane')

    asyncRender().then(
      () => console.log('contctsPane Rendered ' + subject),
      err => complain('' + err))
    return div

    // Async part of render. Maybe API will later allow render to be async
    async function asyncRender () {
      const updater = kb.updater
      UI.aclControl.preventBrowserDropEvents(dom)

      const t = kb.findTypeURIs(subject)

      let me = UI.authn.currentUser()

      const context = {
        target: subject,
        me: me,
        noun: 'address book',
        div: div,
        dom: dom
      } // missing: statusRegion

      //  Render a 3-column browser for an address book or a group
      function renderThreeColumnBrowser (books, context, options) {
        kb.fetcher
          .load(books)
          .then(function (_xhr) {
            renderThreeColumnBrowser2(books, context, options)
          })
          .catch(function (err) {
            complain(err)
          })
      }
      function renderThreeColumnBrowser2 (books, context, options) {
        const classLabel = utils.label(ns.vcard('AddressBook'))
        // const IndividualClassLabel = utils.label(ns.vcard('Individual'))

        let book = books[0] // for now
        const groupIndex = kb.any(book, ns.vcard('groupIndex'))
        let selectedGroups = {}
        let selectedPeople = {} // Actually prob max 1

        const target = options.foreignGroup || book

        let title =
          kb.any(target, ns.dc('title')) || kb.any(target, ns.vcard('fn'))
        if (paneOptions.solo && title && typeof document !== 'undefined') {
          document.title = title.value // @@ only when the outermmost pane
        }
        title = title ? title.value : classLabel

        // The book could be the main subject, or linked from a group we are dealing with
        function findBookFromGroups (book) {
          if (book) {
            return book
          }
          let g
          for (const gu in selectedGroups) {
            g = kb.sym(gu)
            const b = kb.any(undefined, ns.vcard('includesGroup'), g)
            if (b) return b
          }
          throw new Error(
            'findBookFromGroups: Cant find address book which this group is part of'
          )
        }

        //  Write a new contact to the web

        // organization-name is a hack for Mac records with no FN which is mandatory.
        function nameFor (x) {
          const name =
            kb.any(x, ns.vcard('fn')) ||
            kb.any(x, ns.foaf('name')) ||
            kb.any(x, ns.vcard('organization-name'))
          return name ? name.value : '???'
        }

        function filterName (name) {
          const filter = searchInput.value.trim().toLowerCase()
          if (filter.length === 0) return true
          const parts = filter.split(' ') // Each name part must be somewhere
          for (let j = 0; j < parts.length; j++) {
            const word = parts[j]
            if (name.toLowerCase().indexOf(word) < 0) return false
          }
          return true
        }

        function selectPerson (person) {
          cardMain.innerHTML = 'loading...'
          selectedPeople = {}
          selectedPeople[person.uri] = true
          refreshFilteredPeople() // Color to remember which one you picked
          const local = book ? localNode(person) : person
          kb.fetcher.nowOrWhenFetched(local.doc(), undefined, function (
            ok,
            message
          ) {
            cardMain.innerHTML = ''
            if (!ok) {
              return complainIfBad(
                ok,
                "Can't load card: " + local + ': ' + message
              )
            }
            // console.log("Loaded card " + local + '\n')
            cardMain.appendChild(renderPane(dom, local, 'contact'))
            cardMain.appendChild(dom.createElement('br'))

            cardMain.appendChild(UI.widgets.linkIcon(dom, local)) // hoverHide

            // Add in a delete button to delete from AB
            const deleteButton = UI.widgets.deleteButtonWithCheck(
              dom,
              cardMain,
              'contact',
              function () {
                const container = person.dir() // ASSUMPTION THAT CARD IS IN ITS OWN DIRECTORY
                // function warn (message) { return UI.widgets.errorMessageBlock(dom, message, 'straw') }
                alert('Conatiner to delete is ' + container)
                const pname = kb.any(person, ns.vcard('fn'))

                if (
                  confirm(
                    'Delete contact ' + pname + ' completely?? ' + container
                  )
                ) {
                  console.log('Deleting a contact ' + pname)
                  deleteThing(person)
                  //  - delete the references to it in group files and save them background
                  //   - delete the reference in people.ttl and save it back
                  deleteRecursive(kb, container).then(_res => {
                    refreshNames() // Doesn't work
                    cardMain.innerHTML = 'Contact Data Deleted.'
                  })
                }
              }
            )
            deleteButton.style = 'height: 2em;'
          })
        }

        function refreshFilteredPeople (active) {
          let count = 0
          let lastRow = null
          for (let i = 0; i < peopleMainTable.children.length; i++) {
            const row = peopleMainTable.children[i]
            const matches = filterName(nameFor(row.subject))
            if (matches) {
              count++
              lastRow = row
            }
            row.setAttribute(
              'style',
              matches
                ? selectedPeople[row.subject.uri]
                  ? 'background-color: #cce;'
                  : ''
                : 'display: none;'
            )
          }
          if (count === 1 && active) {
            const unique = lastRow.subject
            // selectedPeople = { }
            // selectedPeople[unique.uri] = true
            // lastRow.setAttribute('style', 'background-color: #cce;')
            selectPerson(unique)
          }
        }

        function selectAllGroups (
          selectedGroups,
          groupsMainTable,
          callbackFunction
        ) {
          function fetchGroupAndSelct (group, groupRow) {
            groupRow.setAttribute('style', 'background-color: #ffe;')
            kb.fetcher.nowOrWhenFetched(group.doc(), undefined, function (
              ok,
              message
            ) {
              if (!ok) {
                const msg = "Can't load group file: " + group + ': ' + message
                badness.push(msg)
                return complainIfBad(ok, msg)
              }
              groupRow.setAttribute('style', 'background-color: #cce;')
              selectedGroups[group.uri] = true
              refreshGroupsSelected()
              refreshNames() // @@ every time??
              todo -= 1
              if (!todo) {
                if (callbackFunction) { callbackFunction(badness.length === 0, badness) }
              }
            })
          }
          let todo = groupsMainTable.children.length
          var badness = [] /* eslint-disable-line no-var */
          for (let k = 0; k < groupsMainTable.children.length; k++) {
            const groupRow = groupsMainTable.children[k]
            const group = groupRow.subject
            fetchGroupAndSelct(group, groupRow)
          } // for each row
        }

        function groupsInOrder () {
          let sortMe = []
          if (options.foreignGroup) {
            sortMe.push([
              '',
              kb.any(options.foreignGroup, ns.vcard('fn')),
              options.foreignGroup
            ])
          }
          if (book) {
            books.forEach(function (book) {
              const gs = book ? kb.each(book, ns.vcard('includesGroup'), null, groupIndex) : []
              const gs2 = gs.map(function (g) {
                return [book, kb.any(g, ns.vcard('fn')), g]
              })
              sortMe = sortMe.concat(gs2)
            })
            sortMe.sort()
          }
          return sortMe.map(tuple => tuple[2])
        }

        function renderPane (dom, subject, paneName) {
          const p = dataBrowserContext.session.paneRegistry.byName(paneName)
          const d = p.render(subject, dataBrowserContext)
          d.setAttribute(
            'style',
            'border: 0.1em solid #444; border-radius: 0.5em'
          )
          return d
        }

        function compareForSort (self, other) {
          let s = nameFor(self)
          let o = nameFor(other)
          if (s && o) {
            s = s.toLowerCase()
            o = o.toLowerCase()
            if (s > o) return 1
            if (s < o) return -1
          }
          if (self.uri > other.uri) return 1
          if (self.uri < other.uri) return -1
          return 0
        }

        // In a LDP work, deletes the whole document describing a thing
        // plus patch out ALL mentiosn of it!    Use with care!
        // beware of other dta picked up from other places being smushed
        // together and then deleted.

        function deleteThing (x) {
          console.log('deleteThing: ' + x)
          const ds = kb
            .statementsMatching(x)
            .concat(kb.statementsMatching(undefined, undefined, x))
          const targets = {}
          ds.forEach(function (st) {
            targets[st.why.uri] = st
          })
          const agenda = [] // sets of statements of same document to delete
          for (const target in targets) {
            agenda.push(
              ds.filter(function (st) {
                return st.why.uri === target
              })
            )
            console.log(
              '   Deleting ' +
                agenda[agenda.length - 1].length +
                ' triples from ' +
                target
            )
          }
          function nextOne () {
            if (agenda.length > 0) {
              updater.update(agenda.shift(), [], function (uri, ok, body) {
                if (!ok) {
                  complain('Error deleting all trace of: ' + x + ': ' + body)
                  return
                }
                nextOne()
              })
            } else {
              console.log('Deleting resoure ' + x.doc())
              kb.fetcher
                .delete(x.doc())
                .then(function () {
                  console.log('Delete thing ' + x + ': complete.')
                })
                .catch(function (e) {
                  complain('Error deleting thing ' + x + ': ' + e)
                })
            }
          }
          nextOne()
        }

        //  For deleting an addressbook sub-folder eg person - use with care!
        // @@ move to solid-logic
        function deleteRecursive (kb, folder) {
          return new Promise(function (resolve) {
            kb.fetcher.load(folder).then(function () {
              const promises = kb.each(folder, ns.ldp('contains')).map(file => {
                if (kb.holds(file, ns.rdf('type'), ns.ldp('BasicContainer'))) {
                  return deleteRecursive(kb, file)
                } else {
                  console.log('deleteRecirsive file: ' + file)
                  if (!confirm(' Really DELETE File ' + file)) {
                    throw new Error('User aborted delete file')
                  }
                  return kb.fetcher.webOperation('DELETE', file.uri)
                }
              })
              console.log('deleteRecirsive folder: ' + folder)
              if (!confirm(' Really DELETE folder ' + folder)) {
                throw new Error('User aborted delete file')
              }
              promises.push(kb.fetcher.webOperation('DELETE', folder.uri))
              Promise.all(promises).then(_res => {
                resolve()
              })
            })
          })
        }

        function localNode (person, _div) {
          const aliases = kb.allAliases(person)
          const prefix = book.dir().uri
          for (let i = 0; i < aliases.length; i++) {
            if (aliases[i].uri.slice(0, prefix.length) === prefix) {
              return aliases[i]
            }
          }
          throw new Error('No local URI for ' + person)
        }

        /** Refresh the list of names
        */
        function refreshNames () {
          function setPersonListener (personRow, person) {
            personRow.addEventListener('click', function (event) {
              event.preventDefault()
              selectPerson(person)
            })
          }

          let cards = []
          for (const u in selectedGroups) {
            if (selectedGroups[u]) {
              const a = kb.each(kb.sym(u), ns.vcard('hasMember'))
              cards = cards.concat(a)
            }
          }
          cards.sort(compareForSort) // @@ sort by name not UID later
          for (let k = 0; k < cards.length - 1;) {
            if (cards[k].uri === cards[k + 1].uri) {
              cards.splice(k, 1) // Eliminate duplicates from more than one group
            } else {
              k++
            }
          }

          peopleHeader.textContent =
            cards.length > 5 ? '' + cards.length + ' contacts' : 'contact'

          function renderNameInGroupList (person) {
            const personRow = dom.createElement('tr')
            const personLeft = personRow.appendChild(dom.createElement('td'))
            // const personRight = personRow.appendChild(dom.createElement('td'))
            personLeft.setAttribute('style', dataCellStyle)
            personRow.subject = person
            const name = nameFor(person)
            personLeft.textContent = name
            personRow.subject = person
            UI.widgets.makeDraggable(personRow, person)

            setPersonListener(personRow, person)
            return personRow
          }

          utils.syncTableToArrayReOrdered(peopleMainTable, cards, renderNameInGroupList)
          refreshFilteredPeople()
        } // refreshNames

        function refreshThingsSelected (table, selectionArray) {
          for (let i = 0; i < table.children.length; i++) {
            const row = table.children[i]
            if (row.subject) {
              row.setAttribute(
                'style',
                selectionArray[row.subject.uri] ? 'background-color: #cce;' : ''
              )
            }
          }
        }

        function refreshGroupsSelected () {
          return refreshThingsSelected(groupsMainTable, selectedGroups)
        }

        // Check every group is in the list and add it if not.

        function syncGroupTable () {
          function renderGroupRow (group) {
            // Is something is dropped on a group, add people to group
            async function handleURIsDroppedOnGroup (uris) {
              uris.forEach(function (u) {
                console.log('Dropped on group: ' + u)
                const thing = kb.sym(u)
                try {
                  addPersonToGroup(thing, group)
                } catch (e) {
                  complain(e)
                }
                refreshNames()
              })
            }
            function groupRowClickListener (event) {
              event.preventDefault()
              const groupList = kb.sym(group.uri.split('#')[0])
              if (!event.metaKey) {
                selectedGroups = {} // If Command key pressed, accumulate multiple
              }
              selectedGroups[group.uri] = !selectedGroups[group.uri]
              refreshGroupsSelected()
              peopleMainTable.innerHTML = '' // clear in case refreshNames doesn't work for unknown reason

              kb.fetcher.nowOrWhenFetched(
                groupList.uri,
                undefined,
                function (ok, message) {
                  if (!ok) {
                    return complainIfBad(
                      ok,
                      "Can't load group file: " + groupList + ': ' + message
                    )
                  }
                  refreshNames()

                  if (!event.metaKey) {
                    // If only one group has been selected, show ACL
                    cardMain.innerHTML = ''
                    let visible = false
                    const aclControl = UI.aclControl.ACLControlBox5(
                      group,
                      dataBrowserContext,
                      'group',
                      kb,
                      function (ok, body, response) {
                        if (!ok) {
                          if (response && response.status && response.status === 403) {
                            cardMain.innerHTML = 'No control access.'
                          } else {
                            cardMain.innerHTML = 'Failed to load access control: ' + body
                          }
                        }
                      }
                    )
                    const sharingButton = cardMain.appendChild(
                      dom.createElement('button')
                    )
                    sharingButton.style.cssText =
                      'padding: 1em; margin: 1em'
                    const img = sharingButton.appendChild(
                      dom.createElement('img')
                    )
                    img.style.cssText = 'width: 1.5em; height: 1.5em'
                    img.setAttribute(
                      'src',
                      UI.icons.iconBase + 'noun_123691.svg'
                    )
                    sharingButton.addEventListener('click', function () {
                      visible = !visible
                      if (visible) {
                        cardMain.appendChild(aclControl)
                      } else {
                        cardMain.removeChild(aclControl)
                      }
                    })
                  }
                }
              )
            }

            // Body of renderGroupRow
            const name = kb.any(group, ns.vcard('fn'))
            const groupRow = dom.createElement('tr')
            groupRow.subject = group
            UI.widgets.makeDraggable(groupRow, group)

            groupRow.setAttribute('style', dataCellStyle)
            groupRow.textContent = name

            UI.widgets.makeDropTarget(groupRow, handleURIsDroppedOnGroup)
            UI.widgets.deleteButtonWithCheck(
              dom,
              groupRow,
              'group ' + name,
              function () {
                deleteThing(group)
                syncGroupTable()
              }
            )
            groupRow.addEventListener('click', groupRowClickListener, true)
            return groupRow
          } // renderGroupRow

          const groups = groupsInOrder()
          utils.syncTableToArrayReOrdered(groupsMainTable, groups, renderGroupRow)
          refreshGroupsSelected()
        } // syncGroupTable

        // Click on New Group button
        async function newGroupClickHandler (_event) {
          cardMain.innerHTML = ''
          const groupIndex = kb.any(book, ns.vcard('groupIndex'))
          try {
            await kb.fetcher.load(groupIndex)
          } catch (e) {
            console.log('Error: Group index  NOT loaded:' + e + '\n')
          }
          console.log(' Group index has been loaded\n')

          const name = await UI.widgets.askName(
            dom, kb, cardMain, UI.ns.foaf('name'), ns.vcard('Group'), 'group')
          if (!name) return // cancelled by user
          let group
          try {
            group = await saveNewGroup(book, name, kb)
          } catch (err) {
            console.log("Error: can't save new group:" + err)
            cardMain.innerHTML = 'Failed to save group' + err
            return
          }
          selectedGroups = {}
          selectedGroups[group.uri] = true
          syncGroupTable() // Refresh list of groups

          cardMain.innerHTML = ''
          cardMain.appendChild(UI.aclControl.ACLControlBox5(
            group.doc(), dataBrowserContext, 'group', kb,
            function (ok, body) {
              if (!ok) {
                cardMain.innerHTML =
                    'Group sharing setup failed: ' + body
              }
            }))
        } // newGroupClickHandler

        async function newContactClickHandler (_event) {
          cardMain.innerHTML = ''
          const ourBook = findBookFromGroups(book)
          try {
            await kb.fetcher.load(ourBook)
          } catch (err) {
            throw new Error("Book won't load:" + ourBook)
          }

          const nameEmailIndex = kb.any(ourBook, ns.vcard('nameEmailIndex'))
          if (!nameEmailIndex) throw new Error('Wot no nameEmailIndex?')
          await kb.fetcher.load(nameEmailIndex)
          console.log('Name index loaded async' + nameEmailIndex)

          const name = await UI.widgets
            .askName(dom, kb, cardMain, UI.ns.foaf('name'), ns.vcard('Individual'), 'person')

          if (!name) return // cancelled by user
          cardMain.innerHTML = 'indexing...'
          book = findBookFromGroups(book)
          let person
          try {
            person = await saveNewContact(book, name, selectedGroups, kb)
          } catch (err) {
            const msg = "Error: can't save new contact: " + err
            console.log(msg)
            alert(msg)
          }

          selectedPeople = {}
          selectedPeople[person.uri] = true
          refreshNames() // Add name to list of group
          cardMain.innerHTML = '' // Clear 'indexing'
          cardMain.appendChild(renderPane(dom, person, 'contact'))
        }

        // //////////////////////////// Three-column Contact Browser  - Body
        // //////////////////   Body of 3-column browser

        const bookTable = dom.createElement('table')
        bookTable.setAttribute(
          'style',
          'border-collapse: collapse; margin-right: 0; max-height: 9in;'
        )
        div.appendChild(bookTable)
        /*
        bookTable.innerHTML = `
        <tr>
          <td id="groupsHeader"></td>
          <td id="peopleHeader"></td>
          <td id="cardHeader"></td>
        </tr>
          <tr id="bookMain"></tr>
        <tr>
          <td id="groupsFooter">
          </td><td id="peopleFooter">
          </td><td id="cardFooter">
          </td>
        </tr>`
  */
        const bookHeader = bookTable.appendChild(dom.createElement('tr'))
        const bookMain = bookTable.appendChild(dom.createElement('tr'))
        const bookFooter = bookTable.appendChild(dom.createElement('tr'))

        const groupsHeader = bookHeader.appendChild(dom.createElement('td'))
        const peopleHeader = bookHeader.appendChild(dom.createElement('td'))
        const cardHeader = bookHeader.appendChild(dom.createElement('td'))

        const groupsMain = bookMain.appendChild(dom.createElement('td'))
        const groupsMainTable = groupsMain.appendChild(dom.createElement('table'))
        const peopleMain = bookMain.appendChild(dom.createElement('td'))
        const peopleMainTable = peopleMain.appendChild(dom.createElement('table'))

        const groupsFooter = bookFooter.appendChild(dom.createElement('td'))
        const peopleFooter = bookFooter.appendChild(dom.createElement('td'))
        const cardFooter = bookFooter.appendChild(dom.createElement('td'))

        cardHeader.appendChild(dom.createElement('div')) // searchDiv
        // searchDiv.setAttribute('style', 'border: 0.1em solid #888; border-radius: 0.5em')
        const searchInput = cardHeader.appendChild(dom.createElement('input'))
        searchInput.setAttribute('type', 'text')
        searchInput.setAttribute(
          'style',
          'border: 0.1em solid #444; border-radius: 0.5em; width: 100%; font-size: 100%; padding: 0.1em 0.6em'
        )

        searchInput.addEventListener('input', function (_event) {
          refreshFilteredPeople(true) // Active: select person if just one left
        })

        const cardMain = bookMain.appendChild(dom.createElement('td'))
        cardMain.setAttribute('style', 'margin: 0;') // fill space available
        const dataCellStyle = 'padding: 0.1em;'

        groupsHeader.textContent = 'groups'
        groupsHeader.setAttribute(
          'style',
          'min-width: 10em; padding-bottom 0.2em;'
        )

        function setGroupListVisibility (visible) {
          const vis = visible ? '' : 'display: none;'
          groupsHeader.setAttribute(
            'style',
            'min-width: 10em; padding-bottom 0.2em;' + vis
          )
          const hfstyle = 'padding: 0.1em;'
          groupsMain.setAttribute('style', hfstyle + vis)
          groupsFooter.setAttribute('style', hfstyle + vis)
        }
        setGroupListVisibility(true)

        if (options.foreignGroup) {
          selectedGroups[options.foreignGroup.uri] = true
        }
        if (book) {
          const allGroups = groupsHeader.appendChild(dom.createElement('button'))
          allGroups.textContent = 'All'
          const style = 'margin-left: 1em; font-size: 100%;'
          allGroups.setAttribute('style', style)
          allGroups.addEventListener('click', function (_event) {
            allGroups.state = allGroups.state ? 0 : 1
            peopleMainTable.innerHTML = '' // clear in case refreshNames doesn't work for unknown reason
            if (allGroups.state) {
              allGroups.setAttribute('style', style + 'background-color: #ff8;')
              selectAllGroups(selectedGroups, groupsMainTable, function (
                ok,
                message
              ) {
                if (!ok) return complain(message)
                allGroups.setAttribute(
                  'style',
                  style + 'background-color: black; color: white'
                )
                refreshGroupsSelected()
              })
            } else {
              allGroups.setAttribute('style', style + 'background-color: #cfc;') // pale green hint groups loaded
              selectedGroups = {}
              refreshGroupsSelected()
            }
          }) // on button click
          kb.fetcher.nowOrWhenFetched(groupIndex.uri, book, function (ok, body) {
            if (!ok) return console.log('Cannot load group index: ' + body)
            syncGroupTable()
            refreshNames()
          })
        } else {
          syncGroupTable()
          refreshNames()
          console.log('No book, only one group -> hide list of groups')
          setGroupListVisibility(false) // If no books involved, hide group list
        } // if not book

        peopleHeader.textContent = 'name'
        peopleHeader.setAttribute('style', 'min-width: 18em;')
        peopleMain.setAttribute('style', 'overflow:scroll;')

        // New Contact button
        const newContactButton = dom.createElement('button')
        const container = dom.createElement('div')
        newContactButton.setAttribute('type', 'button')

        if (!me) newContactButton.setAttribute('disabled', 'true')

        UI.authn.checkUser().then(webId => {
          if (webId) {
            me = webId
            newContactButton.removeAttribute('disabled')
          }
        })

        container.appendChild(newContactButton)
        newContactButton.innerHTML = 'New Contact' // + IndividualClassLabel
        peopleFooter.appendChild(container)

        newContactButton.addEventListener('click', newContactClickHandler, false)

        // New Group button
        if (book) {
          const newGroupButton = groupsFooter.appendChild(
            dom.createElement('button')
          )
          newGroupButton.setAttribute('type', 'button')
          newGroupButton.innerHTML = 'New Group' // + IndividualClassLabel
          newGroupButton.addEventListener(
            'click', newGroupClickHandler,
            false
          )

          // Tools button
          const toolsButton = cardFooter.appendChild(dom.createElement('button'))
          toolsButton.setAttribute('type', 'button')
          toolsButton.innerHTML = 'Tools'
          toolsButton.addEventListener('click', function (_event) {
            cardMain.innerHTML = ''
            cardMain.appendChild(
              toolsPane(
                selectAllGroups,
                selectedGroups,
                groupsMainTable,
                book,
                dataBrowserContext,
                me
              )
            )
          })
        } // if book

        cardFooter.appendChild(newAddressBookButton(book))

        // })

        div.appendChild(dom.createElement('hr'))
        //  div.appendChild(newAddressBookButton(book))       // later
        // end of AddressBook instance
      } // renderThreeColumnBrowser

      // ///////////////////////////////////////////////////////////////////////////////////

      //              Render a single contact Individual

      if (
        t[ns.vcard('Individual').uri] ||
        t[ns.vcard('Organization').uri] ||
        t[ns.foaf('Person').uri] ||
        t[ns.schema('Person').uri]
      ) {
        renderIndividual(dom, div, subject, dataBrowserContext).then(() => console.log('(individual rendered)'))

        //          Render a Group instance
      } else if (t[ns.vcard('Group').uri]) {
        // If we have a main address book, then render this group as a guest group within it
        UI.authn
          .findAppInstances(context, ns.vcard('AddressBook'))
          .then(function (context) {
            const addressBooks = context.instances
            const options = { foreignGroup: subject }
            if (addressBooks.length > 0) {
              // const book = addressBooks[0]
              renderThreeColumnBrowser(addressBooks, context, options)
            } else {
              renderThreeColumnBrowser([], context, options)
              // @@ button to Make a new addressBook
            }
          })
          .catch(function (e) {
            UI.widgets.complain(context, e)
          })

        // Render a AddressBook instance
      } else if (t[ns.vcard('AddressBook').uri]) {
        renderThreeColumnBrowser([subject], context, {})
      } else {
        console.log(
          'Error: Contact pane: No evidence that ' +
            subject +
            ' is anything to do with contacts.'
        )
      }

      me = UI.authn.currentUser()
      if (!me) {
        console.log(
          '(You do not have your Web Id set. Sign in or sign up to make changes.)'
        )
        UI.authn.logInLoadProfile(context).then(
          context => {
            console.log('Logged in as ' + context.me)
            me = context.me
          },
          err => {
            div.appendChild(UI.widgets.errorMessageBlock(err))
          }
        )
      } else {
        // console.log("(Your webid is "+ me +")")
      }

      // /////////////// Fix user when testing on a plane

      if (
        typeof document !== 'undefined' &&
        document.location &&
        ('' + document.location).slice(0, 16) === 'http://localhost'
      ) {
        me = kb.any(subject, UI.ns.acl('owner')) // when testing on plane with no webid
        console.log('Assuming user is ' + me)
      }
      return div
    } // asyncRender
  } // render function
} // pane object
// ends
