
// Render a control to record the group memberships we have for this agent
import * as UI from 'solid-ui'

// const $rdf = UI.rdf
const ns = UI.ns
// const buttons = UI.buttonsn  no
// const widgets = UI.widgets
const utils = UI.utils
const kb = UI.store
// const style = UI.style

// Groups the person is a member of
export async function renderGroupMemberships (person, context) {
  // Remove a person from a group
  async function removeFromGroup (thing, group) {
    const pname = kb.any(thing, ns.vcard('fn'))
    const gname = kb.any(group, ns.vcard('fn'))
    const groups = kb.each(null, ns.vcard('hasMember'), thing)
    if (groups.length < 2) {
      alert(
        'Must be a member of at least one group.  Add to another group first.'
      )
      return
    }
    const message = 'Remove ' + pname + ' from group ' + gname + '?'
    if (confirm(message)) {
      const del = kb
        .statementsMatching(person, undefined, undefined, group.doc())
        .concat(kb.statementsMatching(undefined, undefined, person, group.doc()))
      kb.updater.update(del, [], function (uri, ok, err) {
        if (!ok) {
          const message = 'Error removing member from group ' + group + ': ' + err
          groupList.parentNode.appendChild(UI.widgets.errorMessageBlock(dom, message, 'pink'))
        }
      })
      console.log('Removed ' + pname + ' from group ' + gname)
      // to allow refresh of card groupList
      kb.fetcher.unload(group.doc())
      kb.fetcher.load(group.doc())
      syncGroupList()
    }
  }

  function newRowForGroup (group) {
    const options = {
      deleteFunction: function () {
        removeFromGroup(person, group)
      },
      noun: 'membership'
    }
    const tr = UI.widgets.personTR(dom, null, group, options)
    return tr
  }

  function syncGroupList () {
    const groups = kb.each(null, ns.vcard('hasMember'), person)
    console.log('alain groups')
    console.log(groups)
    utils.syncTableToArray(groupList, groups, newRowForGroup)
  }

  async function loadGroupsFromBook () { // book = undefined) {
    // console.log(kb.any(undefined, ns.vcard('includesGroup')))
    // if (!book) {
    const book = kb.any(undefined, ns.vcard('includesGroup'))
    if (!book) {
      throw new Error('findBookFromGroups: Cant find address book which this group is part of')
    }
    // }
    await kb.fetcher.load(book.doc())
    const groupIndex = kb.any(book, ns.vcard('groupIndex'))
    await kb.fetcher.load(groupIndex.doc())
    const gs = book ? kb.each(book, ns.vcard('includesGroup'), null, groupIndex) : []
    console.log('alain gs ' + groupIndex.uri)
    console.log(gs)
    await kb.fetcher.load(gs)
  }

  const { dom } = context
  // const { kb } = context.session.store // alain
  const groupList = dom.createElement('table')

  // find book any group and load all groups
  await loadGroupsFromBook()

  groupList.refresh = syncGroupList
  syncGroupList()
  return groupList
}
