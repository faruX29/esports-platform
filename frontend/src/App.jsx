import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import UpcomingMatches from './UpcomingMatches'
import TeamPage from './TeamPage'
import TournamentPage from './TournamentPage'
import './App.css'

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<UpcomingMatches />} />
          <Route path="/team/:teamId" element={<TeamPage />} />
          <Route path="/tournament/:tournamentId" element={<TournamentPage />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App