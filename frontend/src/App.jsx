import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Explore from './pages/Explore';
import AgentDetail from './pages/AgentDetail';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import NewTask from './pages/NewTask';
import TaskDetail from './pages/TaskDetail';
import ArcJobs from './pages/ArcJobs';
import PredictionMarkets from './pages/PredictionMarkets';
import Funds from './pages/Funds';
import Pipelines from './pages/Pipelines';
import PrivateIntents from './pages/PrivateIntents';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/agents/:id" element={<AgentDetail />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/tasks" element={<Dashboard tab="tasks" />} />
        <Route path="/dashboard/earnings" element={<Dashboard tab="earnings" />} />
        <Route path="/tasks/new" element={<NewTask />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/arc" element={<ArcJobs />} />
        <Route path="/markets" element={<PredictionMarkets />} />
        <Route path="/funds" element={<Funds />} />
        <Route path="/pipelines" element={<Pipelines />} />
        <Route path="/intents" element={<PrivateIntents />} />
      </Routes>
    </Layout>
  );
}

export default App;
